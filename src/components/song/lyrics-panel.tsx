"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePlayerStore } from "@/components/player/player-store";
import type { LyricsLine } from "@/lib/audio/lrc";
import { cn } from "@/lib/utils";

// 同步歌词：跟随全局播放进度高亮当前行，点击行可跳转。
export function LyricsPanel({ lines }: { lines: LyricsLine[] }) {
  const progressSec = usePlayerStore((s) => s.progressSec);
  const seek = usePlayerStore((s) => s.seek);
  const listRef = useRef<HTMLDivElement>(null);

  const progressMs = progressSec * 1000;

  const activeIdx = useMemo(() => {
    for (let i = 0; i < lines.length; i++) {
      if (progressMs >= lines[i].startMs && progressMs < lines[i].endMs) return i;
    }
    return -1;
  }, [lines, progressMs]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx]);

  return (
    <div ref={listRef} className="max-h-[420px] space-y-0.5 overflow-y-auto">
      {lines.map((l, i) => (
        <button
          key={i}
          type="button"
          onClick={() => seek(l.startMs / 1000)}
          className={cn(
            "block w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
            i === activeIdx
              ? "bg-primary/15 font-medium text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {l.text}
        </button>
      ))}
    </div>
  );
}
