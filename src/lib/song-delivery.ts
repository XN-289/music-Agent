import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import type { LyricsLine } from '@/lib/audio/lrc';
import {
  loadPersistedSong,
  persistGeneratedSong,
  type LoadedSongBundle,
} from '@/lib/media-output';
import {
  checkFoliaStage,
  pushSongToFolia,
  type FoliaStagePushResult,
} from '@/lib/folia-stage';

export interface SongDeliveryResult {
  bundle: LoadedSongBundle | null;
  stage: FoliaStagePushResult | null;
  stageSkippedReason?: string;
}

const autoDeliveryPromises = new Map<string, Promise<SongDeliveryResult>>();

export async function ensureLocalSong(songId: string): Promise<LoadedSongBundle | null> {
  const existing = await loadPersistedSong(songId);
  if (existing?.audioPaths.length) return existing;

  const song = (await db.select().from(schema.songs).where(eq(schema.songs.id, songId)))[0];
  if (!song || song.status !== 'done' || !song.variants?.length) return null;

  let lrc: LyricsLine[] = [];
  if (song.lyricsLrc) {
    try {
      lrc = JSON.parse(song.lyricsLrc) as LyricsLine[];
    } catch {
      lrc = [];
    }
  }

  const job = (
    await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.songId, songId))
  )[0];

  await persistGeneratedSong({
    songId,
    title: song.title,
    lyrics: song.lyrics,
    styleTags: song.styleTags,
    prompt: song.prompt,
    jobId: job?.id ?? '',
    providerId: job?.providerId ?? '',
    variants: song.variants,
    lrc,
  });

  return loadPersistedSong(songId);
}

export async function deliverSong(songId: string, opts: { pushToFolia?: boolean } = {}): Promise<SongDeliveryResult> {
  const pushToFolia = opts.pushToFolia ?? true;
  const bundle = await ensureLocalSong(songId);
  if (!bundle) {
    return { bundle: null, stage: null, stageSkippedReason: '歌曲尚未完成或没有可交付音频' };
  }

  if (!pushToFolia) return { bundle, stage: null, stageSkippedReason: '仅本地落盘' };

  const health = await checkFoliaStage();
  if (!health.available) {
    return {
      bundle,
      stage: null,
      stageSkippedReason: health.error ?? 'Folia Stage 未启用或不可达',
    };
  }

  const stage = await pushSongToFolia(bundle);
  return { bundle, stage };
}

/** 生成完成后的非阻塞自动交付：进程内只跑一次，避免多个轮询请求重复上传。 */
export function queueAutoDelivery(songId: string): void {
  if (autoDeliveryPromises.has(songId)) return;
  const pending = deliverSong(songId, { pushToFolia: true })
    .then((result) => {
      if (result.stage && !result.stage.ok) {
        console.warn(`[song-delivery] Folia 推送未完成: ${result.stage.error}`);
      } else if (result.stageSkippedReason) {
        console.warn(`[song-delivery] 跳过 Folia 推送: ${result.stageSkippedReason}`);
      }
      return result;
    })
    .catch((e) => {
      console.warn('[song-delivery] 自动交付失败:', e instanceof Error ? e.message : String(e));
      return { bundle: null, stage: null, stageSkippedReason: '自动交付异常' };
    });
  autoDeliveryPromises.set(songId, pending);
}
