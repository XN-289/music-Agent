// 临时调试：完整走 createAgentSession（与 pi.ts 相同路径），检查 session.state.systemPrompt。
// 用法: node scripts/debug-session-prompt.mjs
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  resolveCliModel,
} from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import path from 'node:path';

for (const line of readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const HARNESS_DIR = path.join(process.cwd(), 'src', 'lib', 'harness');
const FILES = [
  ['prompt.md', ''],
  ['domain/scenarios.md', '领域知识 · 场景库（新手需求 → 专业方向）'],
  ['domain/lyric-writing.md', '领域知识 · 专属写词 Skill（去 AI 味歌词规范，强制）'],
  ['domain/style-tags.md', '领域知识 · 风格标签库与曲风百科'],
  ['domain/song-structure.md', '领域知识 · 歌曲结构规范'],
  ['domain/chinese-style.md', '领域知识 · 国风（五声调式/传统乐器/措辞规范）'],
  ['domain/arrangement-vocal.md', '领域知识 · 编曲与唱腔'],
  ['domain/pronunciation-quirks.md', '领域知识 · 发音怪癖清单'],
  ['domain/quality-gates.md', '领域知识 · 质量门禁'],
  ['workflow.md', '工作流与工具路由'],
];
const SYSTEM_PROMPT = FILES.map(([file, title]) => {
  const content = readFileSync(path.join(HARNESS_DIR, file), 'utf8').trim();
  return title ? `\n\n---\n\n## ${title}\n\n${content}` : `\n\n${content}`;
}).join('');

const cwd = process.cwd();
const agentDir = path.join(cwd, 'data', 'pi-agent');

const modelRuntime = await ModelRuntime.create({
  authPath: path.join(agentDir, 'auth.json'),
  modelsPath: null,
  allowModelNetwork: false,
  refreshOnCreate: false,
});
const resolved = resolveCliModel({
  cliProvider: process.env.LLM_PROVIDER ?? 'deepseek',
  cliModel: process.env.LLM_MODEL ?? 'deepseek-v4-pro',
  modelRuntime,
});
console.log('model:', resolved.model?.provider, resolved.model?.id);

// SDK 对外部 loader 不自动 reload；reload 后才解析 systemPrompt（与 pi.ts 相同的坑与修法）
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

const { session } = await createAgentSession({
  cwd,
  modelRuntime,
  model: resolved.model,
  thinkingLevel: resolved.thinkingLevel,
  noTools: 'builtin',
  customTools: [],
  resourceLoader,
  sessionManager: SessionManager.create(cwd),
});

const sp = session.systemPrompt;
console.log('session.systemPrompt length:', sp?.length);
if (sp && sp.length > 100) {
  console.log('head:', JSON.stringify(sp.slice(0, 80)));
  console.log('tail:', JSON.stringify(sp.slice(-80)));
  console.log('contains 硬门禁:', sp.includes('需求未确认不得生成'));
  console.log('contains 音乐制作人助手:', sp.includes('音乐制作人助手'));
} else {
  console.log('content:', JSON.stringify(sp));
}
