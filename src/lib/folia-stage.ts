import { readFile } from 'node:fs/promises';
import type { LoadedSongBundle } from '@/lib/media-output';

export interface FoliaStageHealth {
  available: boolean;
  enabled?: boolean;
  modeEnabled?: boolean;
  source?: string | null;
  port?: number;
  error?: string;
}

export interface FoliaStagePushResult {
  ok: boolean;
  stage?: unknown;
  foliaWebUrl: string;
  error?: string;
}

function stageBaseUrl(): string {
  return process.env.FOLIA_STAGE_BASE_URL ?? 'http://127.0.0.1:32107';
}

function stageToken(): string {
  return process.env.FOLIA_STAGE_TOKEN ?? '';
}

export function foliaWebUrl(): string {
  return process.env.FOLIA_WEB_URL ?? 'http://127.0.0.1:3001';
}

export async function checkFoliaStage(): Promise<FoliaStageHealth> {
  try {
    const res = await fetch(`${stageBaseUrl().replace(/\/$/, '')}/stage/health`);
    if (!res.ok) {
      return { available: false, error: `Stage health HTTP ${res.status}` };
    }
    const health = (await res.json()) as {
      enabled?: boolean;
      modeEnabled?: boolean;
      source?: string | null;
      port?: number;
    };
    const enabled = health.enabled === true && health.modeEnabled === true && health.source === 'stage-api';
    return {
      available: enabled,
      ...health,
    };
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function toFilePart(filePath: string, mimeType: string, fileName: string): Promise<File> {
  const bytes = await readFile(filePath);
  return new File([new Uint8Array(bytes)], fileName, { type: mimeType });
}

export async function pushSongToFolia(bundle: LoadedSongBundle): Promise<FoliaStagePushResult> {
  const token = stageToken();
  if (!token) {
    return {
      ok: false,
      foliaWebUrl: foliaWebUrl(),
      error: '未配置 FOLIA_STAGE_TOKEN，请先在 Folia 中开启 Stage Mode 并把 token 写入 Music Agent .env.local',
    };
  }

  const audio = bundle.audioPaths[0];
  if (!audio) {
    return {
      ok: false,
      foliaWebUrl: foliaWebUrl(),
      error: '本地还没有可用的音频文件，请确认生成完成后已落盘',
    };
  }

  const form = new FormData();
  form.append('title', bundle.title);
  form.append('artist', 'Music Agent');
  form.append('album', 'Music Agent');
  form.append('lyricsFormat', 'lrc');
  form.append('audioFile', await toFilePart(audio.path, 'audio/mpeg', `${bundle.title}.${audio.path.split('.').pop() ?? 'mp3'}`));
  form.append('lyricsFile', await toFilePart(bundle.lyricsLrcPath, 'text/plain; charset=utf-8', `${bundle.title}.lrc`));

  try {
    const res = await fetch(`${stageBaseUrl().replace(/\/$/, '')}/stage/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      activeEntryKind?: string | null;
    } | null;
    if (!res.ok) {
      return {
        ok: false,
        stage: data,
        foliaWebUrl: foliaWebUrl(),
        error: data?.error ?? `Stage 返回 HTTP ${res.status}`,
      };
    }
    return { ok: true, stage: data, foliaWebUrl: foliaWebUrl() };
  } catch (e) {
    return {
      ok: false,
      foliaWebUrl: foliaWebUrl(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
