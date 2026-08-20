// 公司统一音乐代理（music-proxy-service）适配器。
// 与 sunoapi 的区别：所有能力都走同一个黑盒网关，鉴权使用原始 API Key，
// 不关心上游是 Suno / MiniMax / Mureka，只消费统一 TaskData / UnifiedChoice 合同。
import {
  UnsupportedFeatureError,
  type ExtendInput,
  type GenerateMusicInput,
  type GenerateResult,
  type IterationInput,
  type JobInfo,
  type LyricsLine,
  type ProviderCapability,
  type ReplaceSectionInput,
  type SongVariant,
  type SunoProvider,
} from './types';

const DEFAULT_PROVIDER = 'suno_openaihk';
const DEFAULT_MODEL = 'auto';

function baseUrl(): string {
  return process.env.MUSIC_PROXY_BASE_URL ?? 'http://114.132.214.9:8800';
}

function apiKey(): string {
  return process.env.MUSIC_PROXY_API_KEY ?? '';
}

function providerName(): string {
  return process.env.MUSIC_PROXY_DEFAULT_PROVIDER ?? DEFAULT_PROVIDER;
}

function defaultModel(): string {
  return process.env.MUSIC_PROXY_MODEL ?? DEFAULT_MODEL;
}

class ApiError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(`${baseUrl()}${path}`);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey(),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError('network', `网络错误: ${e instanceof Error ? e.message : String(e)}`);
  }

  const json = (await res.json().catch(() => null)) as {
    code?: number | string;
    msg?: string;
    data?: T & {
      error_code?: string;
      details?: Record<string, unknown>;
    };
  } | null;

  const envelopeCode = Number(json?.code ?? res.status);
  if (!res.ok || envelopeCode < 200 || envelopeCode >= 300) {
    throw new ApiError(
      json?.data?.error_code ?? envelopeCode,
      `${json?.msg ?? json?.data?.error_code ?? '请求失败'}（HTTP ${res.status}）`,
      res.status,
    );
  }

  return json?.data as T;
}

const STATUS_MAP: Record<string, Pick<JobInfo, 'status' | 'progress' | 'stage'>> = {
  pending: { status: 'processing', progress: 8, stage: '排队中' },
  running: { status: 'processing', progress: 48, stage: '渲染中' },
  completed: { status: 'success', progress: 100, stage: '完成' },
};

function isTransientError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code === 'network') return true;
  if (typeof e.code === 'number') {
    return e.code === 429 || e.code >= 500;
  }
  return ['QUEUE_FULL', 'HTTP_502', 'HTTP_503', 'HTTP_504'].includes(String(e.code));
}

interface ProxyTaskData {
  gw_task_id: string;
  provider?: string;
  model?: string;
  status?: string;
  result?: {
    choices?: ProxyChoice[];
  } | null;
  error?: {
    error_code?: string;
    message?: string;
  } | null;
}

interface ProxyChoice {
  id?: string;
  status?: string;
  audio_url?: string;
  stream_url?: string;
  video_url?: string;
  wav_url?: string;
  flac_url?: string;
  image_url?: string;
  duration?: number;
  title?: string;
  tags?: string;
  lyrics?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

interface TimingSection {
  section_type?: string;
  start?: number;
  end?: number;
  lines?: Array<{
    text?: string;
    start?: number;
    end?: number;
    words?: unknown[];
  }>;
}

interface TimingResponse {
  song_id?: string;
  provider?: string;
  sections?: TimingSection[];
}

function toVariants(choices: ProxyChoice[] = []): SongVariant[] {
  return choices
    .filter((choice) => choice.audio_url || choice.stream_url)
    .map((choice, index) => ({
      id: choice.id || `choice-${index}`,
      audioUrl: choice.audio_url || choice.stream_url || '',
      title: choice.title || `Generated ${index + 1}`,
      durationSec: Number.isFinite(choice.duration) ? Math.round(choice.duration as number) : 0,
      audioId: choice.id,
    }));
}

function parseTiming(raw: TimingResponse): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const section of raw.sections ?? []) {
    for (const line of section.lines ?? []) {
      const text = line.text?.trim();
      if (!text) continue;
      const startSec = Number(line.start);
      const endSec = Number(line.end);
      if (!Number.isFinite(startSec) || startSec < 0) continue;
      const startMs = Math.round(startSec * 1000);
      const endMs = Number.isFinite(endSec) ? Math.round(Math.max(endSec, startSec) * 1000) : startMs + 1000;
      lines.push({ startMs, endMs, text });
    }
  }

  // 时间轴通常按行返回；极端情况去重并保持顺序。
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = `${line.startMs}:${line.endMs}:${line.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class MusicProxyProvider implements SunoProvider {
  readonly id = 'musicproxy';
  readonly displayName = '公司统一音乐代理（Suno/Kie 黑盒网关）';
  readonly capabilities = new Set<ProviderCapability>([
    'generate',
    'customGenerate',
    'instrumental',
    'alignedLyrics',
  ]);

  /** 参考音频上传：网关无此能力——抛错交由调用层提示 */
  async uploadReferenceFile(_file: { base64: string; fileName: string }): Promise<{ downloadUrl: string }> {
    throw new UnsupportedFeatureError(this.id, 'uploadReferenceFile（参考音频上传）');
  }

  async generateMusic(input: GenerateMusicInput): Promise<GenerateResult> {
    const style = input.prompt?.trim() || input.styleTags.join(', ').trim() || 'pop, emotional';
    const body: Record<string, unknown> = {
      provider: providerName(),
      task: 'create',
      title: input.title,
      prompt: style,
      model: input.model || defaultModel(),
      make_instrumental: input.instrumental ?? false,
    };

    if (input.lyrics) body.lyrics = input.lyrics;
    if (input.duration != null) {
      const duration = Math.round(input.duration);
      if (duration >= 30 && duration <= 300) body.duration = duration;
    }

    const data = await api<ProxyTaskData>('/api/v1/music/song', { body });
    if (!data.gw_task_id) {
      throw new Error('音乐代理未返回 gw_task_id');
    }
    return { jobId: data.gw_task_id };
  }

  async getJob(jobId: string): Promise<JobInfo<SongVariant[]>> {
    try {
      const data = await api<ProxyTaskData>(`/api/v1/music/tasks/${encodeURIComponent(jobId)}`);
      const status = data.status ?? 'pending';
      const mapped = STATUS_MAP[status];
      if (mapped) {
        return {
          id: jobId,
          ...mapped,
          result: mapped.status === 'success' ? toVariants(data.result?.choices) : undefined,
        };
      }

      if (status === 'failed' || status === 'cancelled') {
        const errorText =
          data.error?.message ??
          data.error?.error_code ??
          (status === 'cancelled' ? '任务已取消' : '生成失败');
        return { id: jobId, status: 'failed', progress: 100, stage: status === 'cancelled' ? '已取消' : '生成失败', error: errorText };
      }

      return { id: jobId, status: 'processing', progress: 48, stage: '上游处理中' };
    } catch (e) {
      if (isTransientError(e)) {
        return { id: jobId, status: 'processing', progress: 5, stage: '上游繁忙，重试中…' };
      }
      return {
        id: jobId,
        status: 'failed',
        progress: 100,
        stage: '查询失败',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async getTimestampedLyrics(taskId: string, audioId: string): Promise<LyricsLine[]> {
    if (!audioId) return [];
    try {
      const data = await api<TimingResponse>('/api/v1/music/lyrics/timing', {
        body: {
          provider: providerName(),
          task_id: taskId,
          clip_id: audioId,
        },
      });
      return parseTiming(data);
    } catch {
      return [];
    }
  }

  async extend(_input: ExtendInput): Promise<GenerateResult> {
    throw new UnsupportedFeatureError(this.id, 'extend');
  }

  async cover(_input: IterationInput): Promise<GenerateResult> {
    throw new UnsupportedFeatureError(this.id, 'cover');
  }

  async replaceSection(_input: ReplaceSectionInput): Promise<GenerateResult> {
    throw new UnsupportedFeatureError(this.id, 'replaceSection');
  }
}
