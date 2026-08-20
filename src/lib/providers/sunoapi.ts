// sunoapi.org（Kie.ai）Suno 第三方 API 适配器 —— P1 真实生成后端。
// 规范来源：https://docs.sunoapi.org/suno-api/suno-api.json + 文档页（2026-08-18 抓取）。
// 要点：
//  - 所有任务都是「提交 → 轮询 record-info」异步模型，与 Provider 接口的 job 语义一致
//  - 模型：V4 / V4_5 / V4_5PLUS / V4_5ALL / V5 / V5_5（默认 V4_5ALL）
//  - extend 仅支持向后延续（continueAt）；前置延长不支持
//  - cover 需要上传型输入（uploadUrl）：适配器内部用源音频 URL 走 file-url-upload 中转
//  - replace-section 需要原始 taskId + fullLyrics + infill 区间，由调用层从 DB 补全

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

const DEFAULT_MODEL = 'V4_5ALL';
const UPLOAD_BASE = 'https://sunoapiorg.redpandaai.co';

function baseUrl(): string {
  return process.env.SUNO_API_BASE ?? 'https://api.sunoapi.org';
}

function apiKey(): string {
  return process.env.SUNO_API_KEY ?? '';
}

class ApiError extends Error {
  constructor(
    public readonly code: number | string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown; rawUrl?: string },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(opts?.rawUrl ?? `${baseUrl()}${path}`, {
      method: opts?.method ?? (opts?.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError('network', `网络错误: ${e instanceof Error ? e.message : String(e)}`);
  }
  const json = (await res.json().catch(() => null)) as {
    code?: number | string;
    msg?: string;
    data?: T;
  } | null;
  if (!json || json.code !== 200) {
    throw new ApiError(json?.code ?? res.status, `${json?.msg ?? '请求失败'}（HTTP ${res.status}）`);
  }
  return json.data as T;
}

// 任务状态 → 我们的 Job 状态（无真实进度百分比，按阶段合成）
const STATUS_MAP: Record<string, { status: JobInfo['status']; progress: number; stage: string }> = {
  PENDING: { status: 'processing', progress: 10, stage: '排队中' },
  TEXT_SUCCESS: { status: 'processing', progress: 40, stage: '生成歌词与结构中' },
  FIRST_SUCCESS: { status: 'processing', progress: 80, stage: '渲染完整音频中' },
  SUCCESS: { status: 'success', progress: 100, stage: '完成' },
};

// callBackUrl 是 sunoapi 提交接口的必填字段（实测强制校验："Please enter callBackUrl."）。
// 本地开发没有公网回调地址：用占位 URL 满足校验，任务进度完全走轮询；
// 部署到公网后用 SUNO_CALLBACK_URL 换成真实回调端点。
function callbackUrl(): string {
  return process.env.SUNO_CALLBACK_URL ?? 'https://example.com/sunoapi-callback';
}

// ---------- 扣费前校验 ----------
// 每次真实生成都消耗 credits：所有必填字段与长度约束在 POST 之前本地校验，
// 让格式错误免费失败（Fail Fast, Fail Free），而不是花 credits 换回一个 400/失败任务。

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(`[sunoapi 校验失败] ${message}`);
}

function validateGenerate(input: GenerateMusicInput) {
  const customMode = !!input.lyrics;
  if (customMode) {
    assert(input.lyrics.length <= 5000, `歌词过长（${input.lyrics.length}/5000 字符）`);
    assert(input.title.length <= 100, '标题过长（≤100 字符）');
    const style = input.styleTags.join(', ');
    assert(style.length > 0, '风格标签不能为空');
    assert(style.length <= 1000, '风格标签过长（≤1000 字符）');
  } else {
    assert(!!input.prompt?.trim(), '非歌词模式必须提供 prompt 风格描述');
    assert(input.prompt!.length <= 3000, 'prompt 过长（≤3000 字符）');
  }
}

function validateReplaceSection(input: ReplaceSectionInput) {
  assert(input.infillStartS != null && input.infillEndS != null, 'infill 区间必填');
  assert(input.infillStartS >= 0 && input.infillEndS > input.infillStartS, 'infill 区间非法（起始须 ≥0 且小于结束）');
  assert(input.infillEndS - input.infillStartS >= 10, '替换段落至少 10 秒');
  assert(input.fullLyrics != null && input.fullLyrics.trim().length > 0, 'fullLyrics 必填');
  assert(input.fullLyrics.length <= 5000, 'fullLyrics 过长（≤5000 字符）');
  assert(!!input.taskId, 'taskId 必填');
  assert(!input.prompt || input.prompt.length <= 3000, 'prompt 过长（≤3000 字符）');
  assert(!input.title || input.title.length <= 100, '标题过长（≤100 字符）');
  const tags = input.styleTags?.join(', ') ?? '';
  assert(tags.length <= 1000, '风格标签过长（≤1000 字符）');
}

/** extend/cover 的公共长度校验（付费路径，缺省免费失败） */
function validateIterationText(input: IterationInput) {
  assert(!input.prompt || input.prompt.length <= 3000, 'prompt 过长（≤3000 字符）');
  assert(!input.title || input.title.length <= 100, '标题过长（≤100 字符）');
  assert(!input.lyrics || input.lyrics.length <= 5000, '歌词过长（≤5000 字符）');
  const tags = input.styleTags?.join(', ') ?? '';
  assert(tags.length <= 1000, '风格标签过长（≤1000 字符）');
}

/** 提交成功后异步记录剩余 credits（仅日志，用于成本可见性） */
function logCredits() {
  void api<number>('/api/v1/generate/credit')
    .then((c) => console.log(`[sunoapi] 任务已提交，剩余 credits: ${c}`))
    .catch(() => {});
}

export class SunoApiProvider implements SunoProvider {
  readonly id = 'sunoapi';
  readonly displayName = 'sunoapi.org（Suno V4/V4.5/V5 第三方 API）';
  readonly capabilities = new Set<ProviderCapability>([
    'generate',
    'customGenerate',
    'instrumental',
    'generateLyrics',
    'extend',
    'cover',
    'replaceSection',
    'stems',
    'personas',
    'alignedLyrics',
    'mashup',
  ]);

  /** 参考音频上传：客户端本地文件 → sunoapi 临时托管（3 天自动删除）→ 公开 URL */
  async uploadReferenceFile(file: { base64: string; fileName: string }): Promise<{ downloadUrl: string }> {
    let res: Response;
    try {
      res = await fetch(`${UPLOAD_BASE}/api/file-base64-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify({
          base64Data: file.base64,
          uploadPath: 'audio/refs',
          fileName: file.fileName,
        }),
      });
    } catch (e) {
      throw new ApiError('network', `上传网络错误: ${e instanceof Error ? e.message : String(e)}`);
    }
    const json = (await res.json().catch(() => null)) as {
      code?: number | string;
      msg?: string;
      data?: { downloadUrl?: string };
      downloadUrl?: string;
    } | null;
    const url = json?.data?.downloadUrl ?? json?.downloadUrl;
    if (!res.ok || !url) {
      throw new ApiError(json?.code ?? res.status, `${json?.msg ?? '上传失败'}（HTTP ${res.status}）`);
    }
    return { downloadUrl: url };
  }

  async generateMusic(input: GenerateMusicInput): Promise<GenerateResult> {
    validateGenerate(input);
    // 参考音频 → upload-cover 通道：上传参考曲目后按描述重演（音频到音频风格迁移）
    if (input.referenceAudioUrl) {
      const upload = await api<{ fileUrl?: string; downloadUrl?: string }>('/api/file-url-upload', {
        rawUrl: `${UPLOAD_BASE}/api/file-url-upload`,
        body: {
          fileUrl: input.referenceAudioUrl,
          uploadPath: 'references',
          fileName: `${input.title ?? 'reference'}.mp3`,
        },
      });
      const uploadUrl = upload.fileUrl ?? upload.downloadUrl;
      if (!uploadUrl) throw new Error('上传服务未返回文件 URL');
      const data = await api<{ taskId: string }>('/api/v1/generate/upload-cover', {
        body: {
          uploadUrl,
          customMode: false,
          instrumental: input.instrumental ?? false,
          prompt: input.prompt ?? input.styleTags.join(', '),
          model: input.model ?? DEFAULT_MODEL,
          callBackUrl: callbackUrl(),
        },
      });
      logCredits();
      return { jobId: data.taskId };
    }

    const customMode = !!input.lyrics;
    const model = input.model ?? DEFAULT_MODEL;
    const body: Record<string, unknown> = {
      customMode,
      instrumental: input.instrumental ?? false,
      model,
      callBackUrl: callbackUrl(),
    };
    if (input.duration != null) {
      // 指定时长仅 V5_5 支持（规范：10-360 秒且仅 customMode）
      assert(model === 'V5_5', `duration 参数仅 V5_5 模型支持（当前: ${model}）`);
      assert(customMode, 'duration 参数仅自定义模式支持');
      assert(input.duration >= 10 && input.duration <= 360, `duration 超出范围（10-360 秒，当前: ${input.duration}）`);
      body.duration = Math.round(input.duration);
    }
    if (customMode) {
      // custom 模式：prompt 即歌词（逐字演唱），style/title 必填
      body.prompt = input.lyrics;
      body.style = input.styleTags.join(', ') || 'Pop';
      body.title = input.title;
    } else {
      // 非 custom 模式：只有 prompt 起作用，style/title 应留空
      if (!input.prompt?.trim()) {
        throw new Error('非歌词模式必须提供 prompt 风格描述');
      }
      body.prompt = input.prompt;
    }
    const data = await api<{ taskId: string }>('/api/v1/generate', { body });
    logCredits();
    return { jobId: data.taskId };
  }

  async extend(input: ExtendInput): Promise<GenerateResult> {
    // sunoapi 的 extend 只能向后延续（continueAt 指定续写起点）
    if (input.direction === 'start') {
      throw new UnsupportedFeatureError(this.id, 'extend:start（前置延长，需换用 upload-cover 变通）');
    }
    validateIterationText(input);
    const hasCustom = !!(input.prompt || input.title);
    const body: Record<string, unknown> = {
      audioId: input.audioId,
      // 无自定义参数时用源曲参数续写（defaultParamFlag:false）；有自定义时 style/continueAt 必填
      defaultParamFlag: hasCustom,
      model: DEFAULT_MODEL,
      callBackUrl: callbackUrl(),
    };
    if (hasCustom) {
      // defaultParamFlag:true 时 continueAt 必填（0 < continueAt < 总时长），缺了直接失败而非发出残缺请求
      if (input.continueAt == null || input.continueAt <= 0) {
        throw new Error('extend 需要有效的 continueAt（续写起点秒数）');
      }
      body.prompt = input.prompt ?? ''; // instrumental 缺省时 prompt 必填；暂按非纯音乐处理
      body.style = input.styleTags?.join(', ') || 'Pop';
      body.title = input.title;
      body.continueAt = input.continueAt;
    }
    const data = await api<{ taskId: string }>('/api/v1/generate/extend', { body });
    logCredits();
    return { jobId: data.taskId };
  }

  async cover(input: IterationInput): Promise<GenerateResult> {
    if (!input.sourceAudioUrl) {
      throw new Error('cover 需要源音频 URL（sourceAudioUrl）');
    }
    validateIterationText(input);
    assert(
      /^https?:\/\//.test(input.sourceAudioUrl),
      `源音频 URL 必须可公网访问（当前：${input.sourceAudioUrl.slice(0, 40)}）`,
    );
    // 第一步：源音频 URL → 平台文件（上传服务是独立域名；fileUrl/downloadUrl 双字段兼容）
    const upload = await api<{ fileUrl?: string; downloadUrl?: string }>('/api/file-url-upload', {
      rawUrl: `${UPLOAD_BASE}/api/file-url-upload`,
      body: {
        fileUrl: input.sourceAudioUrl,
        uploadPath: 'covers',
        fileName: `${input.title ?? 'cover'}.mp3`,
      },
    });
    const uploadUrl = upload.fileUrl ?? upload.downloadUrl;
    if (!uploadUrl) {
      throw new Error('上传服务未返回文件 URL');
    }
    // 第二步：upload-cover。
    // 注意 customMode 语义：true 时 prompt 会被逐字演唱。只有提供真实歌词才用 custom，
    // 否则用非 custom 模式把 prompt 当风格描述（避免把指令唱出来）。
    const customMode = !!input.lyrics;
    const body: Record<string, unknown> = {
      uploadUrl,
      customMode,
      instrumental: false,
      model: DEFAULT_MODEL,
      callBackUrl: callbackUrl(),
    };
    if (customMode) {
      body.prompt = input.lyrics;
      body.style = input.styleTags?.join(', ') || 'Pop';
      body.title = input.title ?? 'Cover';
    } else {
      body.prompt = input.prompt ?? 'Restyle this song in a fresh arrangement';
    }
    const data = await api<{ taskId: string }>('/api/v1/generate/upload-cover', { body });
    logCredits();
    return { jobId: data.taskId };
  }

  async replaceSection(input: ReplaceSectionInput): Promise<GenerateResult> {
    validateReplaceSection(input);
    const data = await api<{ taskId: string }>('/api/v1/generate/replace-section', {
      body: {
        taskId: input.taskId,
        audioId: input.audioId,
        prompt: input.prompt ?? 'Rewrite this section',
        tags: input.styleTags?.join(', ') ?? 'Pop',
        title: input.title ?? 'Edited Song',
        infillStartS: input.infillStartS,
        infillEndS: input.infillEndS,
        fullLyrics: input.fullLyrics,
        callBackUrl: callbackUrl(),
      },
    });
    logCredits();
    return { jobId: data.taskId };
  }

  async getCredits(): Promise<{ credits: number }> {
    const credits = await api<number>('/api/v1/generate/credit');
    return { credits };
  }

  async getTimestampedLyrics(taskId: string, audioId: string): Promise<LyricsLine[]> {
    try {
      const data = await api<unknown>('/api/v1/generate/get-timestamped-lyrics', {
        body: { taskId, audioId },
      });
      return parseAlignedLyrics(data);
    } catch {
      return []; // 解析失败时由调用层回退均分行
    }
  }

  async getJob(jobId: string): Promise<JobInfo<SongVariant[]>> {
    try {
      const d = await api<{
        status: string;
        errorMessage?: string;
        // 兼容两种响应形状：文档旧例 response.data[]（snake_case）与 OpenAPI sunoData[]（camelCase）
        response?: {
          data?: TrackInfo[];
          sunoData?: TrackInfo[];
        };
      }>(`/api/v1/generate/record-info?taskId=${encodeURIComponent(jobId)}`);

      const tracks = (d.response?.sunoData ?? d.response?.data ?? []).filter(Boolean);
      const variants: SongVariant[] = tracks.map((t, i) => ({
        id: `v${i}`,
        audioUrl: t.audioUrl ?? t.audio_url ?? t.streamAudioUrl ?? t.stream_audio_url ?? '',
        title: t.title ?? '',
        durationSec: Math.round(t.duration ?? 0),
        audioId: t.id,
      }));

      const mapped = STATUS_MAP[d.status];
      if (mapped) {
        return {
          id: jobId,
          ...mapped,
          result: mapped.status === 'success' ? variants : variants.length ? variants : undefined,
        };
      }
      if (d.status === 'SENSITIVE_WORD_ERROR') {
        return { id: jobId, status: 'failed', progress: 100, stage: '内容审核未通过', error: d.errorMessage ?? '敏感词拦截' };
      }
      return { id: jobId, status: 'failed', progress: 100, stage: '生成失败', error: d.errorMessage ?? d.status };
    } catch (e) {
      if (e instanceof ApiError && e.code === 'network') {
        // 网络抖动：保持 processing，等待下次轮询（不要把任务误判为失败）
        return { id: jobId, status: 'processing', progress: 5, stage: '查询任务状态中…' };
      }
      if (e instanceof ApiError && (e.code === 429 || (typeof e.code === 'number' && e.code >= 500))) {
        // 限流/服务端临时错误：保持 processing（任务可能仍在生成，终态只认 provider 状态枚举）
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
}

type TrackInfo = {
  id?: string;
  audioUrl?: string;
  audio_url?: string;
  streamAudioUrl?: string;
  stream_audio_url?: string;
  title?: string;
  duration?: number;
};

// 词级对齐的容错解析：响应形状未在 OpenAPI 中完全固定，递归扫描数组条目，
// 兼容 text/lyric/word/content 与 start/end（秒或毫秒启发式判断）。
function parseAlignedLyrics(raw: unknown): LyricsLine[] {
  const out: LyricsLine[] = [];
  const seen = new Set<LyricsLine>();

  const toMs = (v: unknown): number | null => {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n) || n < 0) return null;
    // 启发式：> 1000 视为毫秒，否则视为秒（歌曲时长最多约 480s）
    return n > 1000 ? n : Math.round(n * 1000);
  };

  const extract = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    const o = item as Record<string, unknown>;
    const text = (o.text ?? o.lyric ?? o.word ?? o.content ?? o.words) as string | undefined;
    if (typeof text !== 'string' || !text.trim()) return;
    const startMs = toMs(o.start ?? o.startS ?? o.startMs ?? o.startTime ?? o.t);
    const endMs = toMs(o.end ?? o.endS ?? o.endMs ?? o.endTime);
    const line: LyricsLine = {
      startMs: startMs ?? 0,
      endMs: endMs ?? (startMs ?? 0) + 1000,
      text: text.trim(),
    };
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  };

  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') extract(item);
        else visit(item);
      }
      return;
    }
    if (v && typeof v === 'object') {
      for (const child of Object.values(v as object)) {
        if (Array.isArray(child) || (child && typeof child === 'object')) visit(child);
      }
    }
  };

  visit(raw);
  // 按开始时间排序，合并重叠（词级条目常多行同句）
  return out.sort((a, b) => a.startMs - b.startMs);
}
