import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sweepStaleProcessingSongs } from "@/lib/db/sweep";
import { SongCard } from "@/components/song/song-card";
import { ProcessingRefresher } from "@/components/song/processing-refresher";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  await sweepStaleProcessingSongs(); // mock 重启后的中断任务清扫（进程内只跑一次）
  const songs = await db.select().from(schema.songs).orderBy(desc(schema.songs.createdAt));
  const hasProcessing = songs.some((s) => s.status === "processing");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ProcessingRefresher hasProcessing={hasProcessing} />
      <h1 className="text-2xl font-semibold">曲库</h1>

      {songs.length === 0 ? (
        <div className="mt-20 text-center text-muted-foreground">
          <p className="text-4xl">🎵</p>
          <p className="mt-3">
            还没有歌曲，去{" "}
            <Link href="/" className="text-primary hover:underline">
              创作页
            </Link>{" "}
            生成第一首吧
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {songs.map((s) => (
            <SongCard
              key={s.id}
              song={{
                id: s.id,
                title: s.title,
                styleTags: s.styleTags,
                status: s.status,
                progress: s.progress,
                variants: s.variants,
                createdAt: s.createdAt.getTime(),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
