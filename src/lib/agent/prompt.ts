// 音乐制作人 harness 组装器。
// harness 的领域知识全部沉淀在 src/lib/harness/*.md（可读、可版本化、可蒸馏为独立 skill）：
//   prompt.md  — 角色与行为准则
//   workflow.md — 主流程 / 需求澄清访谈 / 工具路由 / 修复与评估
//   domain/*.md — 风格标签库 / 歌曲结构 / 发音怪癖 / 质量门禁
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
  readPart('domain/lyric-writing.md', '领域知识 · 专属写词 Skill（去 AI 味歌词规范，强制）'),
  readPart('domain/style-tags.md', '领域知识 · 风格标签库'),
  readPart('domain/song-structure.md', '领域知识 · 歌曲结构规范'),
  readPart('domain/pronunciation-quirks.md', '领域知识 · 发音怪癖清单'),
  readPart('domain/quality-gates.md', '领域知识 · 质量门禁'),
  readPart('workflow.md', '工作流与工具路由'),
]
  .join('')
  .replace(/^\n+/, '');
