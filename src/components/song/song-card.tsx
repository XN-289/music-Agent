"use client";

import Link from "next/link";
import { usePlayerStore } from "@/components/player/player-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { coverGradient } from "@/lib/cover";
import { Music2, Pause, Play } from "lucide-react";

export interface SongCardData {
  id: string;
  title: string;
  styleTags: string[] | null;
  status: "draft" | "processing" | "done" | "failed";
  progress: number;
  variants: { id: string; audioUrl: string; title: string; durationSec: number }[] | null;
  createdAt: number;
}

export function SongCard({ song }: { song: SongCardData }) {
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const play = usePlayerStore((s) => s.play);

  const first = song.variants?.[0] ?? null;
  const isActive =
    current != null && song.variants?.some((v) => v.id === current.variantId) === true;

  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-foreground/20">
      <Link href={`/songs/${song.id}`} className="block">
        <div
          className={`relative flex aspect-square items-center justify-center bg-gradient-to-br ${coverGradient(song.title)}`}
        >
          <Music2 className="h-10 w-10 text-white/80" />
          {song.status === "processing" && (
            <Badge className="absolute left-2 top-2 bg-white/90 text-foreground">{song.progress}%</Badge>
          )}
          {song.status === "failed" && (
            <Badge className="absolute left-2 top-2 bg-destructive text-white">失败</Badge>
          )}
        </div>
        <div className="space-y-1 p-3">
          <p className="truncate text-sm font-medium">{song.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {song.styleTags?.join(" · ") || new Date(song.createdAt).toLocaleDateString()}
          </p>
        </div>
      </Link>
      {first && (
        <Button
          size="icon"
          className="absolute bottom-16 right-2 h-9 w-9 rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          aria-label={isActive && playing ? "暂停" : "播放"}
          onClick={() =>
            play({ songId: song.id, variantId: first.id, url: first.audioUrl, title: song.title })
          }
        >
          {isActive && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );
}
