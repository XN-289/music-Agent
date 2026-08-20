// 生成/迭代的共享业务逻辑：pi 工具与 API 路由共用。
// 职责：生成应用层 songId、落库歌曲行与任务行、解析迭代所需的 provider 原生音频 id。
import crypto from 'node:crypto';
import { desc, eq, like, or } from 'drizzle-orm';
import { getProvider } from '@/lib/providers';
import { db, schema } from '@/lib/db';

export interface SubmitGenerationInput {
  title: string;
  lyrics: string;
  styleTags: string[];
  prompt?: string;
  instrumental?: boolean;
  referenceAudioUrl?: string;
  model?: string;
  duration?: number;
}

export async function submitGeneration(input: SubmitGenerationInput) {
  const provider = getProvider();
  const songId = crypto.randomUUID();
  const { jobId } = await provider.generateMusic({
    title: input.title,
    lyrics: input.lyrics,
    styleTags: input.styleTags,
    prompt: input.prompt,
    instrumental: input.instrumental ?? false,
    referenceAudioUrl: input.referenceAudioUrl,
    model: input.model,
    duration: input.duration,
  });

  const now = new Date();
  // 事务：歌曲行与任务行同生共死，避免孤儿 processing 歌曲。
  // 注意：better-sqlite3 是同步驱动，事务回调必须同步执行，且查询是惰性的——必须 .run() 才会执行。
  db.transaction((tx) => {
    tx.insert(schema.songs)
      .values({
        id: songId,
        title: input.title,
        lyrics: input.lyrics,
        styleTags: input.styleTags,
        prompt: input.prompt,
        instrumental: input.instrumental ?? false,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(schema.generationJobs)
      .values({
        id: jobId,
        songId,
        providerId: provider.id,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  return { jobId, songId };
}

/** 为迭代操作创建子歌曲行（版本树节点），挂在父歌下 */
export async function createIterationSong(
  parentSongId: string,
  patch: { title?: string; lyrics?: string; prompt?: string; styleTags?: string[] },
) {
  const parent = (
    await db.select().from(schema.songs).where(eq(schema.songs.id, parentSongId))
  )[0];
  if (!parent) throw new Error(`歌曲不存在: ${parentSongId}`);

  const songId = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.songs).values({
    id: songId,
    parentId: parentSongId,
    chatId: parent.chatId, // 继承会话归属
    title: patch.title ?? parent.title,
    lyrics: patch.lyrics ?? parent.lyrics,
    styleTags: patch.styleTags ?? parent.styleTags,
    prompt: patch.prompt ?? parent.prompt,
    instrumental: parent.instrumental,
    status: 'processing',
    createdAt: now,
    updatedAt: now,
  });
  return { songId, parent };
}

export async function recordJob(jobId: string, songId: string, providerId: string) {
  const now = new Date();
  await db.insert(schema.generationJobs).values({
    id: jobId,
    songId,
    providerId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  });
}

/** 迭代提交 = 子歌曲行 + 任务行，事务保证不出现无任务可查的孤儿歌曲 */
export async function commitIteration(
  parentSongId: string,
  patch: { title?: string; lyrics?: string; prompt?: string; styleTags?: string[] },
  jobId: string,
  providerId: string,
) {
  const { songId } = await createIterationSong(parentSongId, patch);
  try {
    await recordJob(jobId, songId, providerId);
  } catch (e) {
    // 任务行写失败：回滚歌曲行，避免孤儿
    await db.delete(schema.songs).where(eq(schema.songs.id, songId));
    throw e;
  }
  return { songId };
}

/** 迭代前置解析：歌曲行 + 首个变体（含 provider 原生 audioId）+ 原始任务 id */
export async function resolveSongForIteration(songId: string) {
  const song = (await db.select().from(schema.songs).where(eq(schema.songs.id, songId)))[0];
  if (!song) throw new Error(`歌曲不存在: ${songId}`);
  const variant = song.variants?.[0];
  if (!variant?.audioId) {
    throw new Error(`歌曲「${song.title}」还没有可迭代的音频（当前状态: ${song.status}）`);
  }
  const provider = getProvider();
  const job = (
    await db
      .select()
      .from(schema.generationJobs)
      .where(eq(schema.generationJobs.songId, songId))
      .orderBy(desc(schema.generationJobs.createdAt))
  )[0];
  return { song, variant, taskId: job?.id ?? null, providerId: job?.providerId ?? null, activeProviderId: provider.id };
}

/** Agent 视角的歌曲信息（inspect_song 工具用）：诊断失败、对比变体、决定下一步 */
export async function getSongForAgent(songId: string) {
  const song = (await db.select().from(schema.songs).where(eq(schema.songs.id, songId)))[0];
  if (!song) return null;
  // inspect 时同步任务状态：failed 任务的行可能还没被曲库页 sweep 同步（sweep 进程内只跑一次），
  // 会导致 Agent 看到 stale 的「processing」而无法启动自动修复（自动修复链路实测抓出）。
  if (song.status === 'processing') {
    try {
      const job = (
        await db
          .select()
          .from(schema.generationJobs)
          .where(eq(schema.generationJobs.songId, song.id))
      )[0];
      if (job) {
        const memJob = await getProvider().getJob(job.id);
        if (memJob.status === 'failed') {
          const error = memJob.error ?? '生成失败';
          await db
            .update(schema.songs)
            .set({ status: 'failed', error, updatedAt: new Date() })
            .where(eq(schema.songs.id, song.id));
          song.status = 'failed';
          song.error = error;
        }
      }
    } catch {
      // 同步失败不影响 inspect 主流程
    }
  }
  return {
    id: song.id,
    title: song.title,
    status: song.status,
    error: song.error,
    lyrics: song.lyrics,
    styleTags: song.styleTags,
    variants: song.variants ?? [],
    parentId: song.parentId,
  };
}

/** 曲库搜索（search_my_songs 工具用）：按标题/风格描述模糊匹配 */
export async function searchSongs(query: string, limit = 10) {
  const pattern = `%${query.trim()}%`;
  return db
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      styleTags: schema.songs.styleTags,
      prompt: schema.songs.prompt,
      status: schema.songs.status,
    })
    .from(schema.songs)
    .where(or(like(schema.songs.title, pattern), like(schema.songs.prompt, pattern)))
    .orderBy(desc(schema.songs.createdAt))
    .limit(limit);
}
