import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { getProvider } from '@/lib/providers';
import { makeLrc, parseLyricLines } from '@/lib/audio/lrc';

export const dynamic = 'force-dynamic';

// 轮询端点：前端 GenerationCard / 歌曲详情页轮询 job 进度；
// 任务完成或失败时把结果落库（幂等），返回 { job, song }。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const provider = getProvider();
  const job = await provider.getJob(id);

  const jobRow = (
    await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, id))
  )[0];

  if (jobRow) {
    const now = new Date();
    await db
      .update(schema.generationJobs)
      .set({ status: job.status, updatedAt: now })
      .where(eq(schema.generationJobs.id, id));

    if (job.status === 'success') {
      if (!job.result || job.result.length === 0) {
        // 成功但无结果（上游形状异常等）：标记失败，避免歌曲永远卡在生成中
        await db
          .update(schema.songs)
          .set({ status: 'failed', error: '生成完成但未返回音频', updatedAt: now })
          .where(eq(schema.songs.id, jobRow.songId));
      } else {
        const songRow = (
          await db.select().from(schema.songs).where(eq(schema.songs.id, jobRow.songId))
        )[0];
        if (songRow && songRow.status !== 'done') {
          const durationSec = job.result[0].durationSec;
          const lrc = durationSec > 0 ? makeLrc(parseLyricLines(songRow.lyrics ?? ''), durationSec) : [];
          // 守卫更新：仅当仍是 processing 时落库（并发轮询下只完成一次）
          await db
            .update(schema.songs)
            .set({
              status: 'done',
              progress: 100,
              stage: job.stage,
              variants: job.result,
              lyricsLrc: lrc.length ? JSON.stringify(lrc) : null,
              error: null,
              updatedAt: now,
            })
            .where(eq(schema.songs.id, jobRow.songId));
        }
      }
    } else if (job.status === 'failed') {
      await db
        .update(schema.songs)
        .set({ status: 'failed', error: job.error ?? '生成失败', updatedAt: now })
        .where(eq(schema.songs.id, jobRow.songId));
    } else {
      // 处理中：同步进度（进度只增不减，避免瞬时网络错误回退进度条）
      const songRow = (
        await db.select().from(schema.songs).where(eq(schema.songs.id, jobRow.songId))
      )[0];
      const nextProgress = Math.max(songRow?.progress ?? 0, job.progress);
      await db
        .update(schema.songs)
        .set({ progress: nextProgress, stage: job.stage, updatedAt: now })
        .where(eq(schema.songs.id, jobRow.songId));
    }
  }

  const song = jobRow
    ? (await db.select().from(schema.songs).where(eq(schema.songs.id, jobRow.songId)))[0] ?? null
    : null;

  return Response.json({
    job: { id: job.id, status: job.status, progress: job.progress, stage: job.stage, error: job.error },
    song,
  });
}
