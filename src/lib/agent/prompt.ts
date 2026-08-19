// 音乐制作人 harness 组装器。
// harness 的领域知识全部沉淀在 src/lib/harness/*.md（可读、可版本化、可蒸馏为独立 skill）：
//   prompt.md  — 角色与行为准则
//   workflow.md — 主流程 / 需求澄清访谈 / 工具路由 / 修复与评估
//   domain/*.md — 场景库 / 风格标签库与曲风百科 / 歌曲结构 / 国风 / 编曲唱腔 / 发音怪癖 / 质量门禁
// 本文件只负责组装成 SYSTEM_PROMPT；对外发布 skill 时这些 Markdown 原样打包即可。
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HARNESS_DIR = path.join(process.cwd(), 'src', 'lib', 'harness');

function readPart(file: string, title: string): string {
  try {
    const content = readFileSync(path.join(HARNESS_DIR, file), 'utf8').trim();
    if (!content) return '';
    return title ? `\n\n---\n\n## ${title}\n\n${content}` : `\n\n${content}`;
  } catch {
    return ''; // 文件缺失时降级：不因文档问题挂掉服务
  }
}

export const SYSTEM_PROMPT = [
  readPart('prompt.md', ''),
  readPart('domain/scenarios.md', '领域知识 · 场景库（新手需求 → 专业方向）'),
  readPart('domain/lyric-writing.md', '领域知识 · 专属写词 Skill（去 AI 味歌词规范，强制）'),
  readPart('domain/style-tags.md', '领域知识 · 风格标签库与曲风百科'),
  readPart('domain/song-structure.md', '领域知识 · 歌曲结构规范'),
  readPart('domain/chinese-style.md', '领域知识 · 国风（五声调式/传统乐器/措辞规范）'),
  readPart('domain/arrangement-vocal.md', '领域知识 · 编曲与唱腔'),
  readPart('domain/pronunciation-quirks.md', '领域知识 · 发音怪癖清单'),
  readPart('domain/quality-gates.md', '领域知识 · 质量门禁'),
  readPart('workflow.md', '工作流与工具路由'),
]
  .join('')
  .replace(/^\n+/, '');
