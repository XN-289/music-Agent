// 「眼睛」桥：给无视觉模型（deepseek）用的看图层。
// 流程：无头 Edge 截图（或直接传已有图片）→ Ollama qwen2.5vl 视觉模型描述/点评 → 文本输出。
// 用法：
//   node scripts/see.mjs <url 或 图片路径> [问题]
// 例：
//   node scripts/see.mjs http://localhost:3000/library "点评这个页面的 UI：布局/间距/配色/质感，指出最丑和最乱的地方"
//   node scripts/see.mjs data/v2-home.png "这个页面第一屏有什么元素，视觉上有什么问题"
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const OLLAMA = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
const MODEL = process.env.VISION_MODEL ?? "qwen2.5vl:3b";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(
  (p) => existsSync(p),
);

const target = process.argv[2];
const question = process.argv[3] ?? "详细描述这张图的内容";

if (!target) {
  console.error("用法: node scripts/see.mjs <url|图片路径> [问题]");
  process.exit(1);
}

let imagePath = target;
if (/^https?:\/\//.test(target)) {
  if (!EDGE) {
    console.error("未找到 Edge，无法截图 URL");
    process.exit(1);
  }
  imagePath = path.join(process.cwd(), "data", `see-${Date.now()}.png`);
  execFileSync(EDGE, [
    "--headless",
    "--disable-gpu",
    `--screenshot=${imagePath}`,
    "--window-size=1440,900",
    "--virtual-time-budget=10000",
    "--hide-scrollbars",
    target,
  ], { stdio: "ignore", timeout: 60_000 });
  console.log(`[截图] ${target} → ${imagePath}`);
}
if (!existsSync(imagePath)) {
  console.error("图片不存在:", imagePath);
  process.exit(1);
}

const b64 = readFileSync(imagePath).toString("base64");
const res = await fetch(`${OLLAMA}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    stream: false,
    options: { temperature: 0 },
    messages: [{ role: "user", content: question, images: [b64] }],
  }),
});
if (!res.ok) {
  console.error("Ollama 请求失败:", res.status, await res.text().catch(() => ""));
  process.exit(1);
}
const data = await res.json();
console.log(`\n=== ${MODEL} 描述（${imagePath}） ===\n`);
console.log(data.message?.content ?? "(空回复)");
