import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

// 轻量歌曲 DTO：GET /api/songs/[id]（Reuse Prompt 等客户端场景用）
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const song = (await db.select().from(schema.songs).where(eq(schema.songs.id, id)))[0];
  if (!song) {
    return Response.json({ error: '歌曲不存在' }, { status: 404 });
  }
  return Response.json({
    id: song.id,
    title: song.title,
    prompt: song.prompt,
    styleTags: song.styleTags,
    status: song.status,
  });
}
