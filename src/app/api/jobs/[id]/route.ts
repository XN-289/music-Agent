import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { getProvider } from '@/lib/providers';
import { makeLrc, parseLyricLines, type LyricsLine } from '@/lib/audio/lrc';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { queueAutoDelivery } from '@/lib/song-delivery';

export const dynamic = 'force-dynamic';

// 轮询端点：前端 GenerationCard / 歌曲详情页轮询 job 进度；
// 任务完成或失败时把结果落库（幂等），返回 { job, song }。
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 轮询也会打上游 record-info：限流防滥用（对抗性检验 M6）
  const rl = checkRateLimit(`jobs:${clientIp(req)}`, { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: '请求太频繁' }, { status: 429 });
  }
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
          // 词级对齐优先（真实后端），失败/不支持时回退均分行
          let lrc: LyricsLine[] = [];
          try {
            const aligned = await provider.getTimestampedLyrics?.(
              jobRow.id,
              job.result[0].audioId ?? '',
            );
            if (aligned && aligned.length > 0) lrc = aligned;
          } catch {
            // 回退
          }
          if (lrc.length === 0 && durationSec > 0) {
            lrc = makeLrc(parseLyricLines(songRow.lyrics ?? ''), durationSec);
          }
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
            .where(
              and(eq(schema.songs.id, jobRow.songId), eq(schema.songs.status, 'processing')),
            );

          // 自动交付只在生成完成时触发一次，避免阻塞 job 轮询响应。
          queueAutoDelivery(jobRow.songId);
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
