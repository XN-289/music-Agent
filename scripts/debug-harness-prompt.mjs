// 临时调试脚本：绕过 createAgentSession，直接用 ModelRuntime 验证组装后的 SYSTEM_PROMPT
// 是否对模型有控制力（模糊需求 → 应该给方向选项，不生成）。
// 用法: node scripts/debug-harness-prompt.mjs
import { ModelRuntime, resolveCliModel } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 从 .env.local 加载 env（不打印任何值），模拟 Next.js 启动时的 env 注入
for (const line of readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

// 与 src/lib/agent/prompt.ts 相同的组装逻辑
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

console.log('system prompt length:', SYSTEM_PROMPT.length);

const rt = await ModelRuntime.create({
  authPath: path.join(process.cwd(), 'data', 'pi-agent', 'auth.json'),
  modelsPath: null,
  allowModelNetwork: false,
  refreshOnCreate: false,
});

const r = resolveCliModel({
  cliProvider: 'deepseek',
  cliModel: process.env.LLM_MODEL ?? 'deepseek-v4-pro',
  modelRuntime: rt,
});
console.log('model:', r.model?.provider, r.model?.id);

const auth = await rt.getAuth(r.model);
const stream = rt.stream(
  r.model,
  {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: '帮我写首歌吧，好听的就行' }] }],
  },
  { auth },
);

let out = '';
for await (const ev of stream) {
  if (ev.type === 'text_delta') out += ev.delta;
  else if (ev.type === 'done') console.log('\n[done]', (out.match(/生成/g) || []).length, '次提到"生成"');
  else if (ev.type === 'error') console.log('\n[error]', JSON.stringify(ev.error ?? {}).slice(0, 400));
}
console.log('=== 模型回复 ===');
console.log(out.slice(0, 1200));
