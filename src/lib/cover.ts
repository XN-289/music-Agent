// 封面渐变：专辑封面是界面上唯一的色彩来源（设计系统 docs/design-system.md），
// 按标题/标签散列取色——卡片封面与场景瓦片共用同一套暖色系。
export const COVER_GRADIENTS = [
  "from-emerald-500/70 to-teal-700/60",
  "from-amber-500/70 to-orange-700/60",
  "from-rose-500/70 to-red-700/60",
  "from-sky-500/70 to-blue-700/60",
  "from-lime-500/70 to-emerald-700/60",
  "from-cyan-500/70 to-sky-700/60",
] as const;

export function coverGradient(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.codePointAt(0)!) % 997;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}
