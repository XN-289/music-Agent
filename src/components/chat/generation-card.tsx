"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { pollJob, type JobPollResult } from "@/lib/client";
import { usePlayerStore } from "@/components/player/player-store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ExternalLink, Music2, Pause, Play } from "lucide-react";

// 生成卡片：出现在聊天流中，轮询 /api/jobs/[id] 展示进度，
// 完成后提供两个变体的即点播放（Suno 惯例：一次生成 2 个变体做 A/B）。
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
    <div className="w-full max-w-xl rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          <Music2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{res?.job.stage ?? "排队中…"}</p>
        </div>
        {done && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/songs/${songId}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              详情
            </Link>
          </Button>
        )}
      </div>

      {!done && !failed && <Progress value={res?.job.progress ?? 0} className="mt-3" />}
      {failed && <p className="mt-3 text-sm text-destructive">{res?.job.error ?? "生成失败"}</p>}

      {done && (
        <div className="mt-3 flex flex-wrap gap-2">
          {variants.map((v) => {
            const active = current?.variantId === v.id;
            return (
              <Button
                key={v.id}
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() =>
                  play({ songId, variantId: v.id, url: v.audioUrl, title: v.title })
                }
              >
                {active && playing ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {v.id.toUpperCase()}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
