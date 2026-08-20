"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { SongCard, type SongCardData } from "@/components/song/song-card";

// 曲库客户端层：搜索（标题/标签/歌词关键词）+ 风格筛选
export function LibraryClient({ songs }: { songs: SongCardData[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of songs) for (const t of s.styleTags ?? []) set.add(t);
    return [...set].sort();
  }, [songs]);

  const [showAllTags, setShowAllTags] = useState(false);
  const visibleTags = showAllTags ? allTags : allTags.slice(0, 6);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return songs.filter((s) => {
      if (tag && !(s.styleTags ?? []).includes(tag)) return false;
      if (!q) return true;
      return s.title.toLowerCase().includes(q) || (s.styleTags ?? []).some((t) => t.toLowerCase().includes(q));
    });
  }, [songs, query, tag]);

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索歌名或风格"
          className="h-8 w-56"
        />
        {visibleTags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTag(tag === t ? null : t)}
            className={
              tag === t
                ? "rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground"
                : "rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary"
            }
          >
            {t}
          </button>
        ))}
        {allTags.length > 6 && (
          <button
            type="button"
            onClick={() => setShowAllTags((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {showAllTags ? "收起" : `更多 ${allTags.length - 6}`}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-20 text-center text-muted-foreground">
          <p className="text-4xl">🎵</p>
          <p className="mt-3">
            {songs.length === 0 ? (
              <>
                还没有歌曲，去{" "}
                <Link href="/" className="text-primary hover:underline">
                  创作页
                </Link>{" "}
                生成第一首吧
              </>
            ) : (
              "没有匹配的结果"
            )}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((s) => (
            <SongCard key={s.id} song={s} />
          ))}
        </div>
      )}
    </div>
  );
}
