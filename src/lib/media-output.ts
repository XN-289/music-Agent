import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LyricsLine } from '@/lib/audio/lrc';
import type { SongVariant } from '@/lib/providers/types';

export interface PersistSongInput {
  songId: string;
  title: string;
  lyrics: string | null;
  styleTags: string[] | null;
  prompt: string | null;
  jobId: string;
  providerId: string;
  variants: SongVariant[];
  lrc: LyricsLine[];
}

export interface PersistedSongBundle {
  songId: string;
  directory: string;
  metaPath: string;
  lyricsTxtPath: string;
  lyricsLrcPath: string;
  audioPaths: Array<{ variantId: string; path: string; url: string }>;
}

export interface LoadedSongBundle extends PersistedSongBundle {
  title: string;
  lyrics: string | null;
  styleTags: string[] | null;
  prompt: string | null;
  jobId: string;
  providerId: string;
  variants: SongVariant[];
  lrc: LyricsLine[];
}

function mediaRoot(): string {
  const configured = process.env.MEDIA_OUTPUT_DIR?.trim();
  return path.resolve(process.cwd(), configured || 'data/media');
}

function songDirectory(songId: string): string {
  return path.join(mediaRoot(), sanitizeSegment(songId));
}

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return cleaned || 'song';
}

function lrcTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
}

export function lyricsToLrc(lines: LyricsLine[]): string {
  return lines.map((line) => `${lrcTimestamp(line.startMs)}${line.text}`).join('\n');
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(destination, bytes);
}

function extensionForUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.(mp3|wav|flac|m4a)(?:$|[?#])/);
    if (match) return match[1];
  } catch {
    // 保持默认 mp3
  }
  return 'mp3';
}

export async function persistGeneratedSong(input: PersistSongInput): Promise<PersistedSongBundle> {
  const directory = songDirectory(input.songId);
  await mkdir(directory, { recursive: true });

  const audioPaths: PersistedSongBundle['audioPaths'] = [];
  await Promise.all(
    input.variants.map(async (variant, index) => {
      if (!variant.audioUrl) return;
      const ext = extensionForUrl(variant.audioUrl);
      const fileName = `audio-${String(index + 1).padStart(2, '0')}-${sanitizeSegment(variant.id)}.${ext}`;
      const destination = path.join(directory, fileName);
      try {
        await downloadFile(variant.audioUrl, destination);
        audioPaths.push({ variantId: variant.id, path: destination, url: variant.audioUrl });
      } catch (e) {
        console.warn(`[media-output] 音频落盘跳过 ${variant.id}:`, e instanceof Error ? e.message : String(e));
      }
    }),
  );

  const lyricsTxt = input.lyrics ?? '';
  const lyricsLrc = lyricsToLrc(input.lrc);
  const lyricsTxtPath = path.join(directory, 'lyrics.txt');
  const lyricsLrcPath = path.join(directory, 'lyrics.lrc');
  const metaPath = path.join(directory, 'meta.json');

  await Promise.all([
    writeFile(lyricsTxtPath, lyricsTxt, 'utf8'),
    writeFile(lyricsLrcPath, lyricsLrc, 'utf8'),
    writeFile(
      metaPath,
      JSON.stringify(
        {
          songId: input.songId,
          jobId: input.jobId,
          providerId: input.providerId,
          title: input.title,
          lyrics: input.lyrics,
          styleTags: input.styleTags,
          prompt: input.prompt,
          variants: input.variants,
          lrc: input.lrc,
          persistedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    ),
  ]);

  return {
    songId: input.songId,
    directory,
    metaPath,
    lyricsTxtPath,
    lyricsLrcPath,
    audioPaths,
  };
}

export async function loadPersistedSong(songId: string): Promise<LoadedSongBundle | null> {
  const directory = songDirectory(songId);
  const metaPath = path.join(directory, 'meta.json');
  try {
    const raw = await readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw) as {
      title?: string;
      lyrics?: string | null;
      styleTags?: string[] | null;
      prompt?: string | null;
      jobId?: string;
      providerId?: string;
      variants?: SongVariant[];
      lrc?: LyricsLine[];
    };
    const files = await readdir(directory);
    const audioPaths = files
      .filter((file) => /^audio-\d+-\d+-.*\.(mp3|wav|flac|m4a)$/i.test(file))
      .map((file, index) => ({
        variantId: meta.variants?.[index]?.id ?? String(index),
        path: path.join(directory, file),
        url: meta.variants?.[index]?.audioUrl ?? '',
      }));

    return {
      songId,
      directory,
      metaPath,
      lyricsTxtPath: path.join(directory, 'lyrics.txt'),
      lyricsLrcPath: path.join(directory, 'lyrics.lrc'),
      audioPaths,
      title: meta.title ?? 'Untitled',
      lyrics: meta.lyrics ?? null,
      styleTags: meta.styleTags ?? null,
      prompt: meta.prompt ?? null,
      jobId: meta.jobId ?? '',
      providerId: meta.providerId ?? '',
      variants: meta.variants ?? [],
      lrc: meta.lrc ?? [],
    };
  } catch {
    return null;
  }
}
