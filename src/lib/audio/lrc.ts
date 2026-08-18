// 逐行时间戳歌词（LRC 语义），播放器用它做高亮同步。
// 真实 Suno 后端可返回词级时间戳（aligned lyrics），P1 替换 makeLrc 的数据源即可。

export interface LyricsLine {
  startMs: number;
  endMs: number;
  text: string;
}

/** 从带结构标记的歌词文本中提取歌词行（跳过 [Verse] 这类纯标记行） */
export function parseLyricLines(lyrics: string): string[] {
  return lyrics
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]\s*$/.test(l));
}

/** 按时长均分行时间戳（P0 Mock 用；真实对齐数据优先） */
export function makeLrc(lines: string[], durationSec: number): LyricsLine[] {
  if (lines.length === 0) return [];
  const totalMs = durationSec * 1000;
  const step = totalMs / lines.length;
  return lines.map((text, i) => ({
    startMs: Math.round(i * step),
    endMs: Math.round(Math.min((i + 1) * step, totalMs)),
    text,
  }));
}
