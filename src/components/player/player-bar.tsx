"use client";

import { useEffect } from "react";
import Link from "next/link";
import { initPlayerEvents, usePlayerStore } from "./player-store";
import { Button } from "@/components/ui/button";
import { Music2, Pause, Play } from "lucide-react";

// 常驻底栏播放器：全局单例 audio 元素的所有控制都走这里，
// 详情页波形（wavesurfer）共享同一个 media 元素，天然同步。
export function PlayerBar() {
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const progressSec = usePlayerStore((s) => s.progressSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const toggle = usePlayerStore((s) => s.toggle);
  const seek = usePlayerStore((s) => s.seek);

  useEffect(() => {
    initPlayerEvents();
  }, []);

  if (!current) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Link href={`/songs/${current.songId}`} className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-gradient-to-br from-emerald-500/70 to-teal-700/60 text-white">
            <Music2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{current.title}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatTime(progressSec)} / {formatTime(durationSec)}
            </p>
          </div>
        </Link>
        <input
          type="range"
          min={0}
          max={durationSec || 100}
          step={0.1}
          value={Math.min(progressSec, durationSec || 100)}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-emerald-600 disabled:opacity-40"
          disabled={durationSec <= 0}
          aria-label="播放进度"
        />
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
