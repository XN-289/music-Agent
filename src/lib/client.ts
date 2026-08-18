// 客户端 API 助手：轮询生成任务、读取歌曲。
// 所有 Suno 后端都是异步 job 模型，前端统一用 pollJob 驱动进度 UI。

export interface SongDto {
  id: string;
  title: string;
  lyrics: string | null;
  lyricsLrc: string | null;
  styleTags: string[] | null;
  prompt: string | null;
  instrumental: boolean;
  status: 'draft' | 'processing' | 'done' | 'failed';
  progress: number;
  stage: string | null;
  variants: {
    id: string;
    audioUrl: string;
    title: string;
    durationSec: number;
    audioId?: string;
  }[] | null;
  error: string | null;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JobPollResult {
  job: { id: string; status: string; progress: number; stage: string; error?: string };
  song: SongDto | null;
}

export async function pollJob(
  jobId: string,
  onUpdate: (r: JobPollResult) => void,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<JobPollResult> {
  const intervalMs = opts.intervalMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (opts.signal?.aborted) throw new Error('aborted');
    if (Date.now() > deadline) throw new Error('poll timeout');
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(`job poll failed: ${res.status}`);
    const data = (await res.json()) as JobPollResult;
    onUpdate(data);
    if (data.job.status === 'success' || data.job.status === 'failed') return data;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
