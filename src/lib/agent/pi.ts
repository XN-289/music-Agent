// pi Agent 集成 —— Agent 运行时（@earendil-works/pi-agent-core 之上的 SDK 层）。
// 架构：Next.js API 路由（SSE 桥）→ AgentSession.prompt()/subscribe() →
// pi Agent 循环（DeepSeek 或中转站 + 自定音乐工具，无文件/Bash 工具）。
// 会话事件经模块级 hub 广播给所有 SSE 连接。
//
// LLM 两种模式（env 驱动）：
//   1) 直连 DeepSeek：LLM_PROVIDER=deepseek + DEEPSEEK_API_KEY（pi 内置模型目录）
//   2) 中转站/自定义 OpenAI 兼容端点：LLM_BASE_URL + LLM_API_KEY + LLM_MODEL
//      —— 运行时生成 models.json 注册 'relay' provider（api: openai-completions）

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  defineTool,
  resolveCliModel,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { getProvider } from '@/lib/providers';
import { SYSTEM_PROMPT } from './prompt';
import {
  commitIteration,
  getSongForAgent,
  resolveSongForIteration,
  submitGeneration,
} from './generate-song';

// ---------- 工具定义 ----------

const generateMusicToolDef = defineTool({
  name: 'generate_music',
  label: '生成歌曲',
  description:
    '为已确认的歌曲方案生成音乐。歌词必须带结构标记 [Intro]/[Verse]/[Chorus]/[Bridge]/[Outro]，styleTags 是 2-6 个 Suno 风格标签。调用后返回 songId 与 jobId，不要重复调用。',
  promptSnippet: 'generate_music(title, lyrics, styleTags) → { jobId, songId }',
  parameters: Type.Object({
    title: Type.String({ description: '歌曲标题' }),
    lyrics: Type.String({
      description: '完整歌词，结构标记用英文方括号：[Intro]/[Verse]/[Chorus]/[Bridge]/[Outro]',
    }),
    styleTags: Type.Array(Type.String(), {
      description: '2-6 个 Suno 风格标签，如 "dreamy pop"、"female vocals"',
    }),
    prompt: Type.Optional(Type.String({ description: '一句话风格描述' })),
    instrumental: Type.Optional(Type.Boolean({ default: false, description: '是否纯音乐' })),
  }),
  execute: async (_toolCallId, params) => {
    const { jobId, songId } = await submitGeneration({
      title: params.title,
      lyrics: params.lyrics,
      styleTags: params.styleTags,
      prompt: params.prompt,
      instrumental: params.instrumental ?? false,
    });
    return {
      content: [{ type: 'text', text: '生成任务已提交' }],
      details: { jobId, songId },
    };
  },
}) as ToolDefinition;

const extendMusicToolDef = defineTool({
  name: 'extend_music',
  label: '延长歌曲',
  description:
    '延长一首已生成的歌曲（续写结尾）。songId 用之前 generate_music 返回的 id。direction=end 为向后延续；direction=start（加前奏）当前后端可能不支持，失败时向用户说明。',
  promptSnippet: 'extend_music(songId, direction, prompt?) → { jobId, songId }',
  parameters: Type.Object({
    songId: Type.String({ description: '已生成歌曲的 id' }),
    direction: Type.Union([Type.Literal('start'), Type.Literal('end')], { default: 'end' }),
    prompt: Type.Optional(Type.String({ description: '延续段落的方向描述' })),
    contextSeconds: Type.Optional(Type.Number({ description: '参考原始结尾多少秒' })),
  }),
  execute: async (_toolCallId, params) => {
    const { variant } = await resolveSongForIteration(params.songId);
    const provider = getProvider();
    // contextSeconds 是「参考原曲结尾多少秒」，sunoapi 的 continueAt 是续写起点 → 换算
    const continueAt =
      params.contextSeconds != null && params.contextSeconds > 0
        ? Math.max(1, Math.round((variant.durationSec || 24) - params.contextSeconds))
        : undefined;
    const { jobId } = await provider.extend({
      audioId: variant.audioId!,
      direction: params.direction,
      prompt: params.prompt,
      contextSeconds: params.contextSeconds,
      continueAt,
      title: `${variant.title} (Extended)`,
      sourceAudioUrl: variant.audioUrl,
    });
    const { songId } = await commitIteration(
      params.songId,
      { title: `${variant.title} (Extended)`, prompt: params.prompt },
      jobId,
      provider.id,
    );
    return {
      content: [{ type: 'text', text: '延长任务已提交' }],
      details: { jobId, songId },
    };
  },
}) as ToolDefinition;

const coverMusicToolDef = defineTool({
  name: 'cover_music',
  label: '翻唱 / 重混歌曲',
  description: '把一首已生成的歌曲用新的风格/唱法重新演绎。songId 用之前返回的 id，prompt 描述想要的新风格。',
  promptSnippet: 'cover_music(songId, prompt?, title?) → { jobId, songId }',
  parameters: Type.Object({
    songId: Type.String({ description: '已生成歌曲的 id' }),
    prompt: Type.Optional(Type.String({ description: '新风格描述，如 "lo-fi 女声慢板"' })),
    title: Type.Optional(Type.String({ description: '翻唱版标题' })),
  }),
  execute: async (_toolCallId, params) => {
    const { song, variant } = await resolveSongForIteration(params.songId);
    const provider = getProvider();
    const { jobId } = await provider.cover({
      audioId: variant.audioId!,
      sourceAudioUrl: variant.audioUrl,
      styleTags: song.styleTags ?? [],
      prompt: params.prompt,
      title: params.title,
    });
    const { songId } = await commitIteration(
      params.songId,
      { title: params.title ?? `${song.title} (Cover)`, prompt: params.prompt },
      jobId,
      provider.id,
    );
    return {
      content: [{ type: 'text', text: '翻唱任务已提交' }],
      details: { jobId, songId },
    };
  },
}) as ToolDefinition;

const replaceSectionToolDef = defineTool({
  name: 'replace_section',
  label: '替换歌曲段落',
  description:
    '替换一首歌中的某一段（例如重写第二段主歌）。songId 用之前返回的 id；infillStartS/infillEndS 是要替换的时间区间（秒），拿不准时先让用户确认。',
  promptSnippet: 'replace_section(songId, prompt, infillStartS, infillEndS) → { jobId, songId }',
  parameters: Type.Object({
    songId: Type.String({ description: '已生成歌曲的 id' }),
    prompt: Type.String({ description: '新段落的内容/风格描述' }),
    infillStartS: Type.Optional(Type.Number({ description: '替换区间起点（秒）' })),
    infillEndS: Type.Optional(Type.Number({ description: '替换区间终点（秒）' })),
  }),
  execute: async (_toolCallId, params) => {
    const { song, variant, taskId, providerId, activeProviderId } =
      await resolveSongForIteration(params.songId);
    if (!taskId) throw new Error('缺少原始生成任务信息，无法替换段落');
    if (providerId !== activeProviderId) {
      throw new Error(`该歌曲由 ${providerId} 生成，当前后端是 ${activeProviderId}，无法跨后端迭代`);
    }
    const provider = getProvider();
    const { jobId } = await provider.replaceSection({
      audioId: variant.audioId!,
      taskId,
      prompt: params.prompt,
      styleTags: song.styleTags ?? [],
      title: `${song.title} (Edit)`,
      infillStartS: params.infillStartS,
      infillEndS: params.infillEndS,
      fullLyrics: song.lyrics ?? '',
    });
    const { songId } = await commitIteration(
      params.songId,
      { title: `${song.title} (Edit)`, prompt: params.prompt },
      jobId,
      provider.id,
    );
    return {
      content: [{ type: 'text', text: '段落替换任务已提交' }],
      details: { jobId, songId },
    };
  },
}) as ToolDefinition;

const inspectSongToolDef = defineTool({
  name: 'inspect_song',
  label: '查看歌曲状态',
  description:
    '查询一首歌的当前状态、失败原因与变体信息。用于：诊断生成失败、对比两个变体、确认段落替换的时间区间、决定下一步迭代。songId 来自之前工具的结果。',
  promptSnippet: 'inspect_song(songId) → { status, error, variants, lyrics }',
  parameters: Type.Object({
    songId: Type.String({ description: '歌曲 id' }),
  }),
  execute: async (_toolCallId, params) => {
    const info = await getSongForAgent(params.songId);
    // 统一 details 形状，避免 defineTool 泛型推断分叉
    const details: { songId: string; status: string | null; error: string | null } = info
      ? { songId: params.songId, status: info.status, error: info.error }
      : { songId: params.songId, status: null, error: null };
    if (!info) {
      return {
        content: [{ type: 'text', text: '歌曲不存在，请让用户确认 songId' }],
        details,
      };
    }
    const lines = [
      `标题：${info.title}`,
      `状态：${info.status}${info.error ? `（失败原因：${info.error}）` : ''}`,
      `风格标签：${info.styleTags?.join(', ') ?? '无'}`,
      `变体：${info.variants.map((v) => `${v.id}「${v.title}」${v.durationSec}s`).join('；') || '暂无'}`,
      `歌词：${info.lyrics ?? '无'}`,
    ];
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      details,
    };
  },
}) as ToolDefinition;

const CUSTOM_TOOLS: ToolDefinition[] = [
  generateMusicToolDef,
  extendMusicToolDef,
  coverMusicToolDef,
  replaceSectionToolDef,
  inspectSongToolDef,
];

// ---------- 会话单例 ----------

let sessionPromise: Promise<AgentSession> | null = null;

function createSession(): Promise<AgentSession> {
  const cwd = process.cwd();
  const agentDir = path.join(cwd, 'data', 'pi-agent');

  return (async () => {
    // 中转站模式：LLM_BASE_URL 存在 → 运行时生成 models.json 注册 'relay' provider
    let modelsPath: string | null = null;
    let providerId = process.env.LLM_PROVIDER ?? 'deepseek';
    let modelId = process.env.LLM_MODEL ?? 'deepseek-v4-flash';

    if (process.env.LLM_BASE_URL) {
      providerId = 'relay';
      modelId = process.env.LLM_MODEL ?? '';
      if (!modelId) {
        throw new Error('中转站模式（LLM_BASE_URL）必须同时配置 LLM_MODEL');
      }
      if (!process.env.LLM_API_KEY) {
        throw new Error('中转站模式（LLM_BASE_URL）必须同时配置 LLM_API_KEY');
      }
      await mkdir(agentDir, { recursive: true });
      const modelsJson = {
        providers: {
          relay: {
            baseUrl: process.env.LLM_BASE_URL,
            api: 'openai-completions',
            // $ENV 插值：key 不落盘，未配置时 pi 会给出明确的 "no API key" 错误
            apiKey: '$LLM_API_KEY',
            models: [
              {
                id: modelId,
                // 中转站多为 OpenAI 兼容网关：禁用 developer 角色与 reasoning_effort，避免请求参数不兼容
                compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
              },
            ],
          },
        },
      };
      await writeFile(path.join(agentDir, 'models.json'), JSON.stringify(modelsJson, null, 2));
      modelsPath = path.join(agentDir, 'models.json');
    }

    const modelRuntime = await ModelRuntime.create({
      authPath: path.join(agentDir, 'auth.json'),
      modelsPath, // null = 只用内置模型目录（DeepSeek 内置）
      allowModelNetwork: false,
      refreshOnCreate: false,
    });

    const resolved = resolveCliModel({ cliProvider: providerId, cliModel: modelId, modelRuntime });
    if (!resolved.model) {
      throw new Error(
        `模型不可用：${providerId}/${modelId}。直连请检查 DEEPSEEK_API_KEY；中转站请检查 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`,
      );
    }

    const { session } = await createAgentSession({
      cwd,
      modelRuntime,
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      noTools: 'builtin', // 禁用 read/bash/edit/write 编码工具，仅保留自定义工具
      customTools: CUSTOM_TOOLS,
      resourceLoader: new DefaultResourceLoader({
        cwd,
        agentDir,
        systemPrompt: SYSTEM_PROMPT,
        noContextFiles: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noExtensions: true,
      }),
      sessionManager: SessionManager.create(cwd),
    });

    return session;
  })();
}

export function getPiSession(): Promise<AgentSession> {
  if (!sessionPromise) {
    sessionPromise = createSession();
    // 创建失败后重置缓存，下次请求重试（而不是永远返回同一个 rejected promise）
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

// ---------- 提示词串行化 ----------
// pi 的 followUp 队列不会等待处理完成（prompt() 立即返回），且会话事件经全局 hub 广播，
// 并发请求会造成事件串流与消息丢失。单会话场景下用 promise 链串行化：
// 同一时刻只有一个 prompt 在跑，事件与当前请求一一对应。

let promptChain: Promise<unknown> = Promise.resolve();

export async function queuePrompt(text: string): Promise<void> {
  const run = promptChain.then(async () => {
    const session = await getPiSession();
    await session.prompt(text, { streamingBehavior: 'followUp' });
  });
  // 无论成败都让链条继续，但把错误抛给调用方
  promptChain = run.catch(() => {});
  return run;
}

// ---------- 事件广播（session 级订阅 → 所有 SSE 连接） ----------

type SessionEvent = AgentSessionEvent;
type Listener = (event: SessionEvent) => void;

const listeners = new Set<Listener>();
let subscribed = false;

async function ensureSubscription() {
  if (subscribed) return;
  const session = await getPiSession();
  session.subscribe((event) => {
    for (const cb of listeners) cb(event);
  });
  subscribed = true; // 订阅成功后才置位，失败时下次 addSessionListener 会重试
}

export function addSessionListener(cb: Listener): () => void {
  listeners.add(cb);
  void ensureSubscription();
  return () => {
    listeners.delete(cb);
  };
}

/** 从 AgentMessage content 中提取文本（message_update 时发累计文本，客户端直接替换） */
export function messageText(message: unknown): string {
  const m = message as { content?: Array<{ type: string; text?: string }> };
  if (!Array.isArray(m?.content)) return '';
  return m.content
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}
