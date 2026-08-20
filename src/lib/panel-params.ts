// 创作参数面板的选项词表 —— 客户端渲染与服务端白名单校验共用（单一词表，防漂移）。
// 值形如「中文标签(英文tag)」；服务端只接受词表内的精确值，杜绝任意字符进提示词数据块。
// 词表取自 harness 风格标签库（曲风/情绪/唱腔三层）的新手常用子集。

export interface PanelOptionItem {
  label: string; // 中文显示
  tag: string; // 英文 Suno 标签
}

export const GENRE_OPTIONS: PanelOptionItem[] = [
  { label: "流行", tag: "pop" },
  { label: "民谣", tag: "folk" },
  { label: "摇滚", tag: "rock" },
  { label: "说唱", tag: "hip hop" },
  { label: "R&B", tag: "R&B" },
  { label: "电子", tag: "electronic" },
  { label: "国风", tag: "pentatonic, chinese traditional" },
  { label: "爵士", tag: "jazz" },
  { label: "轻音乐", tag: "lo-fi" },
  { label: "梦幻流行", tag: "dream pop" },
  { label: "抒情", tag: "ballad" },
];

export const MOOD_OPTIONS: PanelOptionItem[] = [
  { label: "开朗", tag: "upbeat" },
  { label: "治愈", tag: "calm" },
  { label: "温柔", tag: "tender" },
  { label: "浪漫", tag: "romantic" },
  { label: "怀旧", tag: "nostalgic" },
  { label: "忧郁", tag: "melancholic" },
  { label: "热血", tag: "energetic" },
  { label: "梦幻", tag: "dreamy" },
  { label: "暗黑", tag: "dark" },
  { label: "松弛", tag: "chill" },
];

export const VOCAL_OPTIONS: PanelOptionItem[] = [
  { label: "女声", tag: "female vocals" },
  { label: "男声", tag: "male vocals" },
  { label: "童声", tag: "child vocals" },
  { label: "合唱", tag: "choir" },
  { label: "气声", tag: "whisper vocals" },
  { label: "高亢", tag: "powerful vocals" },
  { label: "甜美", tag: "sweet vocals" },
  { label: "纯音乐", tag: "instrumental" },
];

/** 面板分组（服务端按序拼提示词、客户端按序渲染） */
export const PANEL_GROUPS = [
  { key: "genre", label: "曲风", options: GENRE_OPTIONS },
  { key: "mood", label: "心情", options: MOOD_OPTIONS },
  { key: "vocal", label: "音色", options: VOCAL_OPTIONS },
] as const;

export type PanelKey = (typeof PANEL_GROUPS)[number]["key"];

/** 值是否命中词表（服务端白名单：精确匹配，杜绝任意字符进提示词数据块） */
export function panelValueOf(key: PanelKey, value: string): boolean {
  return PANEL_GROUPS.some(
    (g) => g.key === key && g.options.some((o) => `${o.label}(${o.tag})` === value),
  );
}
