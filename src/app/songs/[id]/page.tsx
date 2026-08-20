import { desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db, schema } from '@/lib/db';
import type { LyricsLine } from '@/lib/audio/lrc';
import { SongDetailClient, type SongDetailData } from '@/components/song/song-detail-client';

export const dynamic = 'force-dynamic';

function toSongDetailData(
  song: typeof schema.songs.$inferSelect,
): SongDetailData {
  return {
    id: song.id,
    title: song.title,
    lyrics: song.lyrics,
    styleTags: song.styleTags,
    prompt: song.prompt,
    instrumental: song.instrumental,
    status: song.status,
    progress: song.progress,
    stage: song.stage,
    variants: song.variants,
    error: song.error,
    createdAt: song.createdAt.getTime(),
  };
}

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const song = (await db.select().from(schema.songs).where(eq(schema.songs.id, id)))[0];
  if (!song) notFound();

  // 生成任务：详情页在歌曲仍处 processing 时继续轮询
  const job =
    (await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.songId, id)))[0] ??
    null;

  // 版本树：父版本 + 衍生版本（迭代操作产生的子歌曲）
  const parent = song.parentId
    ? ((await db.select().from(schema.songs).where(eq(schema.songs.id, song.parentId)))[0] ?? null)
    : null;
  const children = await db
    .select()
    .from(schema.songs)
    .where(eq(schema.songs.parentId, id))
    .orderBy(desc(schema.songs.createdAt));

  let lrc: LyricsLine[] = [];
  if (song.lyricsLrc) {
    try {
      lrc = JSON.parse(song.lyricsLrc) as LyricsLine[];
    } catch {
      // 解析失败则无同步歌词
    }
  }

  return (
    <SongDetailClient
      key={song.id} // 跨歌曲导航时重置客户端状态（变体选择/对话框/输入）
      song={toSongDetailData(song)}
      jobId={job?.id ?? null}
      lrc={lrc}
      parent={parent ? toSongDetailData(parent) : null}
      childVersions={children.map(toSongDetailData)}
    />
  );
}
