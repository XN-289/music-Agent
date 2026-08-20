import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sweepStaleProcessingSongs } from "@/lib/db/sweep";
import { LibraryClient } from "@/components/song/library-client";
import { ProcessingRefresher } from "@/components/song/processing-refresher";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  await sweepStaleProcessingSongs(); // mock 重启后的中断任务清扫（进程内只跑一次）
  const songs = await db.select().from(schema.songs).orderBy(desc(schema.songs.createdAt));
  const hasProcessing = songs.some((s) => s.status === "processing");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">曲库</h1>
      <LibraryClient
        songs={songs.map((s) => ({
          id: s.id,
          title: s.title,
          styleTags: s.styleTags,
          status: s.status,
          progress: s.progress,
          variants: s.variants as never,
          createdAt: s.createdAt.getTime(),
        }))}
      />
      {/* 生成中的曲目自动刷新（客户端轮询） */}
      <ProcessingRefresher hasProcessing={hasProcessing} />
    </div>
  );
}
