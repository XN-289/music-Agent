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
import { readdirSync, statSync } from 'node:fs';
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
  searchSongs,
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
      minItems: 2,
      maxItems: 6,
    }),
    prompt: Type.Optional(Type.String({ description: '一句话风格描述' })),
    instrumental: Type.Optional(Type.Boolean({ default: false, description: '是否纯音乐' })),
    referenceAudioUrl: Type.Optional(
      Type.String({ description: '参考音频 URL（用户提供时传此参数，按其风格创作）' }),
    ),
    model: Type.Optional(
      Type.String({ description: '模型版本（默认 V4_5ALL；指定时长必须用 V5_5）' }),
    ),
    duration: Type.Optional(
      Type.Number({ description: '指定歌曲时长（秒，10-360，仅 V5_5 模型支持）' }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    spendPaidCallBudget(); // 付费调用预算：防注入批量烧钱
    const { jobId, songId } = await submitGeneration({
      title: params.title,
      lyrics: params.lyrics,
      styleTags: params.styleTags,
      prompt: params.prompt,
      instrumental: params.instrumental ?? false,
      referenceAudioUrl: params.referenceAudioUrl,
      model: params.model,
      duration: params.duration,
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
    spendPaidCallBudget(); // 付费调用预算：防注入批量烧钱
    const { song, variant } = await resolveSongForIteration(params.songId);
    const provider = getProvider();
    // continueAt 是续写起点：默认参考结尾 30 秒上下文
    const ctxSec = params.contextSeconds != null && params.contextSeconds > 0 ? params.contextSeconds : 30;
    const continueAt = Math.max(1, Math.round((variant.durationSec || 24) - ctxSec));
    const { jobId } = await provider.extend({
      audioId: variant.audioId!,
      direction: params.direction,
      prompt: params.prompt,
      contextSeconds: params.contextSeconds,
      continueAt,
      styleTags: song.styleTags ?? [],
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
    spendPaidCallBudget(); // 付费调用预算：防注入批量烧钱
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
    spendPaidCallBudget(); // 付费调用预算：防注入批量烧钱
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

const searchSongsToolDef = defineTool({
  name: 'search_my_songs',
  label: '搜索曲库',
  description:
    '在用户曲库里按关键词搜索已生成的歌曲（匹配标题/风格描述），返回 songId 与基本信息。用户提到「上次那首」「那首关于xx的歌」时先调用它拿到 songId，再用迭代工具操作。',
  promptSnippet: 'search_my_songs(query) → [{ id, title, styleTags, status }]',
  parameters: Type.Object({
    query: Type.String({ description: '搜索关键词（歌名/主题/风格）' }),
  }),
  execute: async (_toolCallId, params) => {
    const songs = await searchSongs(params.query);
    if (songs.length === 0) {
      return {
        content: [{ type: 'text', text: '曲库中没有匹配的歌曲，请让用户确认描述' }],
        details: { results: [] },
      };
    }
    const text = songs
      .map((s) => `- ${s.id}｜${s.title}｜${s.styleTags?.join(', ') ?? ''}｜${s.status}`)
      .join('\n');
    return {
      content: [{ type: 'text', text }],
      details: { results: songs.map((s) => ({ id: s.id, title: s.title })) },
    };
  },
}) as ToolDefinition;

const CUSTOM_TOOLS: ToolDefinition[] = [
  generateMusicToolDef,
  extendMusicToolDef,
  coverMusicToolDef,
  replaceSectionToolDef,
  inspectSongToolDef,
  searchSongsToolDef,
];

// ---------- 会话 per-chat 化 ----------
// 每个 chatId 一个独立的 AgentSession（独立历史 + 独立系统提示词状态 + 独立事件路由），
// 修掉「新对话还记着上一场的事」的串台问题（此前全部 chat 共享一个模块级单例）。
// 会话历史由 pi SessionManager 持久化在 data/pi-agent/chats/<sha256(chatId)>/ 下，
// 进程重启后按 chatId 重建 session 时自动恢复历史；内存 LRU（MAX_CHATS）驱逐只丢缓存不丢历史。

import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const MAX_CHATS = 10;

interface ChatSessionEntry {
  sessionPromise: Promise<AgentSession>;
  chain: Promise<unknown>; // 该 chat 内 turn 串行化（pi followUp 不等待完成，并发会串流）
  running: boolean;
  listeners: Set<Listener>;
  subscribed: boolean;
  lastUsed: number;
}

const chatSessions = new Map<string, ChatSessionEntry>();

/** chatId 是用户可控输入，不能直接当目录名——哈希防路径穿越 */
function chatSessionDir(chatId: string): string {
  const h = crypto.createHash('sha256').update(chatId).digest('hex').slice(0, 24);
  return path.join(process.cwd(), 'data', 'pi-agent', 'chats', h);
}

/**
 * 会话目录里最新的一条会话文件。pi 的 SessionManager.create() 每次都新建带时间戳的
 * jsonl（不重开旧文件），所以恢复历史必须显式找到最新文件用 open() 打开。
 */
function findLatestSessionFile(dir: string): string | null {
  let best: { path: string; mtimeMs: number } | null = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    const mtimeMs = statSync(p).mtimeMs;
    if (!best || mtimeMs > best.mtimeMs) best = { path: p, mtimeMs };
  }
  return best?.path ?? null;
}

function getChatEntry(chatId: string): ChatSessionEntry {
  const existing = chatSessions.get(chatId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (chatSessions.size >= MAX_CHATS) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of chatSessions) {
      if (v.lastUsed < oldestTs) {
        oldestTs = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) chatSessions.delete(oldestKey);
  }
  const entry: ChatSessionEntry = {
    sessionPromise: createSession(chatId),
    chain: Promise.resolve(),
    running: false,
    listeners: new Set(),
    subscribed: false,
    lastUsed: Date.now(),
  };
  chatSessions.set(chatId, entry);
  return entry;
}

function createSession(chatId: string): Promise<AgentSession> {
  const cwd = process.cwd();
  const agentDir = path.join(cwd, 'data', 'pi-agent');
  const sessionDir = chatSessionDir(chatId);

  return (async () => {
    await mkdir(sessionDir, { recursive: true });
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

    // 注意：SDK 对外部传入的 loader 实例不会自动 reload()，而 systemPrompt 在 reload 里才解析——
    // 不调用会把音乐 harness 提示词整个丢掉，模型回退到 pi 默认编码助手提示词（真实生成验证抓出）。
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      systemPrompt: SYSTEM_PROMPT,
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noExtensions: true,
    });
    await resourceLoader.reload({});

    const existingSessionFile = findLatestSessionFile(sessionDir);
    const sessionManager = existingSessionFile
      ? SessionManager.open(existingSessionFile, sessionDir, cwd) // 恢复该 chat 的历史
      : SessionManager.create(cwd, sessionDir);

    const { session } = await createAgentSession({
      cwd,
      modelRuntime,
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      noTools: 'builtin', // 禁用 read/bash/edit/write 编码工具，仅保留自定义工具
      customTools: CUSTOM_TOOLS,
      resourceLoader,
      sessionManager,
    });

    return session;
  })();
}

// ---------- 提示词串行化（per-chat） ----------
// pi 的 followUp 队列不会等待处理完成（prompt() 立即返回），同一 chat 并发请求会造成
// 事件串流与消息丢失，所以每个 chat 内部用 promise 链串行化；不同 chat 互不阻塞。

export const MAX_PAID_CALLS_PER_TURN = 3;

// 付费调用预算：用 AsyncLocalStorage 绑定到「当前 turn」（并发 chat 各算各的）；
// 万一 ALS 上下文丢失（工具在 pi 内部脱离 prompt 链执行），回落到全局共享计数器兜底。
const budgetAls = new AsyncLocalStorage<{ calls: number }>();
const globalBudget = { calls: 0 };

/** 当前 chat 是否有一个 turn 正在运行（并发请求直接 409，防止事件串流与重复扣费） */
export function isPromptRunning(chatId: string): boolean {
  return chatSessions.get(chatId)?.running ?? false;
}

/** 付费工具调用预算：一次用户 turn 最多 N 次真实生成（防提示词注入批量烧钱） */
export function spendPaidCallBudget(): void {
  const counter = budgetAls.getStore() ?? globalBudget;
  counter.calls += 1;
  if (counter.calls > MAX_PAID_CALLS_PER_TURN) {
    throw new Error(
      `本轮已触发 ${MAX_PAID_CALLS_PER_TURN} 次生成/迭代，超过上限。如需更多请让用户在新一轮明确确认。`,
    );
  }
}

export async function queuePrompt(chatId: string, text: string): Promise<void> {
  const entry = getChatEntry(chatId);
  const run = entry.chain.then(async () => {
    entry.running = true;
    globalBudget.calls = 0; // 兜底计数器的重置（ALS 正常时每个 turn 有自己的 store）
    try {
      const session = await entry.sessionPromise;
      await budgetAls.run({ calls: 0 }, () =>
        session.prompt(text, { streamingBehavior: 'followUp' }),
      );
    } finally {
      entry.running = false;
    }
  });
  // 无论成败都让链条继续，但把错误抛给调用方
  entry.chain = run.catch(() => {});
  return run;
}

// ---------- 事件广播（per-chat：会话事件只路由给该 chat 的 SSE 连接） ----------

type SessionEvent = AgentSessionEvent;
type Listener = (event: SessionEvent) => void;

async function ensureSubscription(entry: ChatSessionEntry) {
  if (entry.subscribed) return;
  const session = await entry.sessionPromise;
  session.subscribe((event) => {
    for (const cb of entry.listeners) cb(event);
  });
  entry.subscribed = true; // 订阅成功后才置位，失败时下次 addSessionListener 会重试
}

export function addSessionListener(chatId: string, cb: Listener): () => void {
  const entry = getChatEntry(chatId);
  entry.listeners.add(cb);
  void ensureSubscription(entry);
  return () => {
    entry.listeners.delete(cb);
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
