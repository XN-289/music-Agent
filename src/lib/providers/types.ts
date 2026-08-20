// Suno Provider 抽象 —— 兼容层核心（参考 ai-music-studio 的 MusicProvider 模式）。
// 所有 Suno 后端（官方/社区 cookie/第三方商业 API）都是「提交任务 → 轮询结果」的异步模型，
// 只有轮询端点不同，因此接口统一为 job 语义。
// P0 只有 generate + getJob；extend / cover / generateLyrics 等 P1 接真实后端时按同模式扩展。

export type ProviderCapability =
  | 'generate'
  | 'customGenerate'
  | 'instrumental'
  | 'generateLyrics'
  | 'extend'
  | 'cover'
  | 'replaceSection'
  | 'mashup'
  | 'concat'
  | 'stems'
  | 'personas'
  | 'alignedLyrics';

export type JobStatus = 'pending' | 'processing' | 'success' | 'failed';

export interface LyricsLine {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SongVariant {
  id: string;
  audioUrl: string;
  title: string;
  durationSec: number;
  /** Provider 原生音频 id（extend/cover 等迭代操作的输入） */
  audioId?: string;
}

export interface GenerateMusicInput {
  title: string;
  /** 带结构标记的歌词：[Intro]/[Verse]/[Chorus]/[Bridge]/[Outro] */
  lyrics: string;
  /** Suno 风格标签，如 ["dreamy pop", "female vocals", "lofi"] */
  styleTags: string[];
  /** 自由文本风格描述（可选） */
  prompt?: string;
  instrumental?: boolean;
  model?: string;
  /** 参考音频 URL（音频到音频风格迁移；sunoapi 走 upload-cover 通道） */
  referenceAudioUrl?: string;
  /** 指定时长（秒，10-360；仅 V5_5 模型支持） */
  duration?: number;
}

export interface GenerateResult {
  /** 异步任务 id，轮询 getJob 获取结果 */
  jobId: string;
}

export type ExtendDirection = 'start' | 'end';

/** 迭代操作公共入参（都以某个已生成音频为基底） */
export interface IterationInput {
  audioId: string;
  prompt?: string;
  lyrics?: string;
  title?: string;
  /** 风格标签（cover 等需要） */
  styleTags?: string[];
  /** 源音频可访问 URL（上传型 cover 需要） */
  sourceAudioUrl?: string;
}

export interface ExtendInput extends IterationInput {
  direction: ExtendDirection;
  /** 提供给模型的原始上下文时长（秒）；由调用层换算成 continueAt（续写起点） */
  contextSeconds?: number;
  /** 续写起点（秒，0 < continueAt < 总时长）：sunoapi 语义，由调用层按 duration - contextSeconds 计算 */
  continueAt?: number;
}

export interface ReplaceSectionInput extends IterationInput {
  /** 目标段落序号（无对齐数据时用 prompt 描述） */
  sectionIndex?: number;
  /** 替换区间的起止（秒，sunoapi 必填，优先于 sectionIndex） */
  infillStartS?: number;
  infillEndS?: number;
  /** 完整歌词（替换后全文） */
  fullLyrics?: string;
  /** 原始生成任务 id（sunoapi 必填） */
  taskId?: string;
}

export interface JobInfo<T = unknown> {
  id: string;
  status: JobStatus;
  /** 0-100 */
  progress: number;
  /** 人类可读的当前阶段，如 "渲染音频" */
  stage: string;
  result?: T;
  error?: string;
}

export interface SunoProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  generateMusic(input: GenerateMusicInput): Promise<GenerateResult>;
  getJob(jobId: string): Promise<JobInfo<SongVariant[]>>;
  // P1 迭代操作：真实后端按能力实现，不支持时抛 UnsupportedFeatureError
  extend(input: ExtendInput): Promise<GenerateResult>;
  cover(input: IterationInput): Promise<GenerateResult>;
  replaceSection(input: ReplaceSectionInput): Promise<GenerateResult>;
  /** 剩余额度（可选实现；mock 不限额度则缺省） */
  getCredits?(): Promise<{ credits: number }>;
  /** 词级时间戳歌词（可选实现；返回空数组时由调用层回退均分行） */
  getTimestampedLyrics?(taskId: string, audioId: string): Promise<LyricsLine[]>;
  /** 参考音频上传：本地文件 → 后端托管 URL（sunoapi 临时存储 3 天，mock 返回假 URL） */
  uploadReferenceFile(file: { base64: string; fileName: string }): Promise<{ downloadUrl: string }>;
  // P1.5+ 扩展点（对齐调研结论的接口设计）：
  // generateLyrics / mashup / concat / stemSplit
  // listPersonas / createPersona / deletePersona / download
}

export class UnsupportedFeatureError extends Error {
  constructor(providerId: string, feature: string) {
    super(`Provider "${providerId}" does not support: ${feature}`);
    this.name = 'UnsupportedFeatureError';
  }
}
