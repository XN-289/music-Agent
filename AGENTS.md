<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 视觉桥使用手册（qwen2.5vl:3b，本地 CPU）

本机 Ollama 跑 qwen2.5vl:3b 给无视觉 LLM 当眼睛：`node scripts/see.mjs <url|图片路径> [问题]`（单次约 1-3 分钟）。**已摸清的能力边界与用法：**

| 能力 | 水平 | 用法 |
|---|---|---|
| OCR/文字识别 | 强（逐字准确） | 问「XX 区域写的什么字」——核对渲染结果首选 |
| 元素计数/存在性 | 强 | 问「有几个卡片/按钮在不在」 |
| 布局结构 | 可用 | 问「从上到下列出区域」 |
| 颜色识别 | 粗粒度（绿/白可辨，灰白难分） | 只问颜色大类，精确色值用 `scripts/png-sample.mjs` 像素采样 |
| 对比判断 | 方向可靠，理由可能编造 | 并排小图问「哪个好」，别信它说的原因 |
| 绝对美学点评 | 泛化模板 | 不要开放式问「点评一下」，没价值 |
| 大图 | ❌ 宽图/大图拖垮 CPU 会超时 | **截图 ≤1440px 宽**；看细节时用 `--window-size` 小窗口截局部，不要放大全页 |

**铁律**：单次一张图、一个问题；问题要「有已知答案」式的具体问题；超时就把图缩小重试。deepseek 会话本身没有视觉，看到「[截图]」只是文件路径。
