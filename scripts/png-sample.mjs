// PNG 像素采样：无依赖解码 PNG（zlib 内置），采样指定坐标的颜色。
// 用途：无头截图后验证主题色是否真正渲染（模型不支持看图时的替代验证手段）。
// 用法: node scripts/png-sample.mjs <file.png> [x,y] [x,y] ...
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const [, , file, ...points] = process.argv;
const buf = readFileSync(file);

// 解析 chunk：IHDR + 合并 IDAT
let pos = 8;
let width, height, bitDepth, colorType;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === "IDAT") {
    idat.push(data);
  }
  pos += 12 + len;
}
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
  console.error("unsupported png format:", bitDepth, colorType);
  process.exit(1);
}
const bpp = colorType === 6 ? 4 : 3;

// 反过滤
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * bpp;
const out = Buffer.alloc(height * stride);
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  const rowIn = y * (stride + 1) + 1;
  const rowOut = y * stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[rowOut + x - bpp] : 0;
    const b = y > 0 ? out[rowOut - stride + x] : 0;
    const c = y > 0 && x >= bpp ? out[rowOut - stride + x - bpp] : 0;
    let v = raw[rowIn + x];
    switch (filter) {
      case 0: break;
      case 1: v = (v + a) & 0xff; break;
      case 2: v = (v + b) & 0xff; break;
      case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
      case 4: {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
        break;
      }
    }
    out[rowOut + x] = v;
  }
}

const hex = (r, g, b) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
console.log(`size: ${width}x${height}`);
for (const p of points) {
  const [x, y] = p.split(",").map(Number);
  const o = (y * stride) + x * bpp;
  console.log(`(${x},${y}) = ${hex(out[o], out[o + 1], out[o + 2])}${bpp === 4 ? ` alpha=${out[o + 3]}` : ""}`);
}
