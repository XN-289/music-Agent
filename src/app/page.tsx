import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ChatView } from "@/components/chat/chat-view";
import type { SongCardData } from "@/components/song/song-card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // 空态展示最近成品（建立信任 + 一键试听）
  const recent = await db
    .select()
    .from(schema.songs)
    .where(eq(schema.songs.status, "done"))
    .orderBy(desc(schema.songs.createdAt))
    .limit(8);

  const recentSongs: SongCardData[] = recent.map((s) => ({
    id: s.id,
    title: s.title,
    styleTags: s.styleTags,
    status: s.status,
    progress: s.progress,
    variants: s.variants as SongCardData["variants"],
    createdAt: s.createdAt.getTime(),
  }));

  return (
    <Suspense fallback={null}>
      <ChatView recentSongs={recentSongs} />
    </Suspense>
  );
}
