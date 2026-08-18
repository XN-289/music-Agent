// 惰性清扫：把「服务重启后无对应内存任务的 processing 歌曲」标记失败。
// 在曲库页 / 详情页 / jobs 轮询等入口调用一次（进程内只跑一次），
// 避免 mock 重启后曲库里永远卡在「生成中」的脏数据。

import { db, schema } from '../db';
import { getProvider } from '../providers';
import { eq } from 'drizzle-orm';

let swept = false;

export async function sweepStaleProcessingSongs() {
  if (swept) return;
  swept = true;
  try {
    const provider = getProvider();
    if (provider.id !== 'mock') return; // 真实后端任务状态以远端为准

    const processing = await db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.status, 'processing'));

    for (const song of processing) {
      const job = (
        await db
          .select()
          .from(schema.generationJobs)
          .where(eq(schema.generationJobs.songId, song.id))
      )[0];
      if (!job) continue;
      // 任务已失败（包括重启恢复为「中断」的任务）→ 同步歌曲为失败，给出可行动的提示
      const memJob = await provider.getJob(job.id);
      if (memJob.status === 'failed') {
        await db
          .update(schema.songs)
          .set({
            status: 'failed',
            error: memJob.error?.startsWith('mock: restarted')
              ? '开发服务器重启导致任务中断，请重新生成'
              : (memJob.error ?? '生成失败'),
            updatedAt: new Date(),
          })
          .where(eq(schema.songs.id, song.id));
      }
    }
  } catch {
    // 清扫失败不影响主流程
  }
}
