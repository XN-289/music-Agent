"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { pollJob, type JobPollResult } from "@/lib/client";
import { usePlayerStore } from "@/components/player/player-store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ExternalLink, Music2, Pause, Play } from "lucide-react";

// 生成卡片：出现在聊天流中，轮询 /api/jobs/[id] 展示阶段化进度，
// 完成后提供两个变体的醒目试听卡片（Suno 惯例：一次生成 2 个变体做 A/B）。
export function GenerationCard({
  jobId,
  songId,
  title,
}: {
  jobId: string;
  songId: string;
  title: string;
}) {
  const [res, setRes] = useState<JobPollResult | null>(null);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const play = usePlayerStore((s) => s.play);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    pollJob(
      jobId,
      (r) => {
        if (!cancelled) setRes(r);
      },
      { signal: controller.signal },
    ).catch(() => {
      // 轮询失败时静默；卡片停留在最后状态（中止/超时不再产生请求）
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [jobId]);

  const variants = res?.song?.variants ?? [];
  const done = res?.job.status === "success";
  const failed = res?.job.status === "failed";

  return (
    <div className="w-full max-w-xl rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
          <Music2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {done ? "生成完成，试听两个变体" : failed ? "生成失败" : "正在制作中…"}
          </p>
        </div>
        {done && (
          <Button variant="outline" size="sm" render={<Link href={`/songs/${songId}`} />}>
            <ExternalLink className="h-3.5 w-3.5" />
            详情
          </Button>
        )}
      </div>

      {!done && !failed && (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
            </span>
            {res?.job.stage ?? "排队中…"} · {res?.job.progress ?? 0}%
          </p>
          <Progress value={res?.job.progress ?? 0} />
        </div>
      )}
      {failed && <p className="mt-3 text-sm text-destructive">{res?.job.error ?? "生成失败"}</p>}

      {done && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {variants.map((v, i) => {
            const active = current?.variantId === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => play({ songId, variantId: v.id, url: v.audioUrl, title: v.title })}
                className={
                  active
                    ? "flex flex-col gap-1.5 rounded-md border border-primary bg-primary/10 p-3 text-left transition-colors"
                    : "flex flex-col gap-1.5 rounded-md border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                }
              >
                <span className="flex items-center justify-between">
                  <span className="text-xs font-semibold">变体 {i === 0 ? "A" : "B"}</span>
                  {active && playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {active ? "正在播放" : "点击试听"} · {Math.round(v.durationSec || 0)}s
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
