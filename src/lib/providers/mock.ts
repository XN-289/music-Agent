import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  UnsupportedFeatureError,
  type ExtendInput,
  type GenerateMusicInput,
  type GenerateResult,
  type IterationInput,
  type JobInfo,
  type ReplaceSectionInput,
  type SongVariant,
  type SunoProvider,
} from './types';

const SAMPLE_RATE = 22050;
const DURATION_SEC = 24;
const AUDIO_DIR = path.join(process.cwd(), 'public', 'generated');
const JOB_FILE = path.join(process.cwd(), 'data', 'mock-jobs.json');
const MAX_PERSISTED_JOBS = 300;
const AUDIO_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天

// ---------- 确定性伪随机（同一 songId 永远生成同一首歌，方便复现 demo） ----------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// 大调 I–V–vi–IV 及其变体（midi 音高数组）
const PROGRESSIONS: number[][][] = [
  [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], // C  G  Am F
  [[55, 59, 62], [50, 54, 57], [52, 55, 59], [48, 52, 55]], // G  D  Em C
  [[57, 60, 64], [52, 56, 59], [49, 52, 56], [45, 49, 52]], // Am E  F  Dm
];

// ---------- WAV 合成：和弦琶音 + 贝斯 + 五声音阶旋律，模拟一首短歌 ----------

function synthesizeWav(seed: number): Buffer {
  const rng = mulberry32(seed);
  const bpm = 84 + Math.floor(rng() * 28); // 84–112
  const barDur = (60 / bpm) * 4;
  const totalSamples = SAMPLE_RATE * DURATION_SEC;
  const progression = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];

  const samples = new Float64Array(totalSamples);
  const eighth = barDur / 8;

  for (let bar = 0; bar < Math.ceil(DURATION_SEC / barDur); bar++) {
    const chord = progression[bar % progression.length];
    const bassMidi = chord[0] - 24;
    const barStart = bar * barDur;

    // 贝斯：每小节一个根音
    addTone(samples, barStart, barDur, midiFreq(bassMidi), 0.28, rng, { wave: 'sine' });

    // 琶音：八分音符循环和弦音
    for (let e = 0; e < 8; e++) {
      const note = chord[e % chord.length] + (e >= 4 ? 12 : 0);
      addTone(samples, barStart + e * eighth, eighth * 0.9, midiFreq(note), 0.22, rng, {
        wave: 'sine',
        overtone: 0.35,
      });
    }

    // 旋律：五声音阶随机点缀
    const pentatonic = [0, 2, 4, 7, 9].map((iv) => chord[0] + 12 + iv);
    for (let e = 0; e < 8; e++) {
      if (rng() < 0.45) {
        const note = pentatonic[Math.floor(rng() * pentatonic.length)];
        addTone(samples, barStart + e * eighth, eighth * 0.7, midiFreq(note), 0.15, rng, {
          wave: 'triangle',
        });
      }
    }
  }

  // 淡入淡出
  const fade = Math.floor(SAMPLE_RATE * 0.3);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    samples[i] *= g;
    samples[totalSamples - 1 - i] *= g;
  }

  return toWav(samples);
}

function addTone(
  samples: Float64Array,
  startSec: number,
  durSec: number,
  freq: number,
  amp: number,
  rng: () => number,
  opts: { wave: 'sine' | 'triangle'; overtone?: number },
) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const len = Math.floor(durSec * SAMPLE_RATE);
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= samples.length) break;
    const t = i / SAMPLE_RATE;
    // 指数衰减包络
    const env = Math.exp(-3.5 * (t / durSec));
    let v: number;
    if (opts.wave === 'triangle') {
      v = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * freq * t + phase));
    } else {
      v = Math.sin(2 * Math.PI * freq * t + phase);
      if (opts.overtone) v += opts.overtone * Math.sin(4 * Math.PI * freq * t + phase);
    }
    samples[idx] += v * amp * env;
  }
}

function toWav(samples: Float64Array): Buffer {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// ---------- Mock Provider：内存 job 状态机 ----------

export class MockSunoProvider implements SunoProvider {
  readonly id = 'mock';
  readonly displayName = 'Mock（P0 演示，本地合成）';
  readonly capabilities = new Set([
    'generate',
    'customGenerate',
    'instrumental',
    'extend',
    'cover',
    'replaceSection',
  ] as const);

  private jobs = new Map<string, JobInfo<SongVariant[]>>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // 跨重启持久化：恢复上次任务状态；进行中的任务已随进程中断 → 标记失败
    this.restoreJobs();
    void this.cleanupOldAudio();
    // 周期性清理（对抗性检验 D1：init-only 会让长期运行的 dev server 无限堆积 WAV）
    const timer = setInterval(() => void this.cleanupOldAudio(), 24 * 3600 * 1000);
    timer.unref?.();
  }

  private restoreJobs() {
    try {
      const raw = JSON.parse(readFileSync(JOB_FILE, 'utf8')) as JobInfo<SongVariant[]>[];
      for (const job of raw) {
        if (job.status === 'pending' || job.status === 'processing') {
          job.status = 'failed';
          job.progress = 100;
          job.stage = '服务重启，任务中断';
          job.error = 'mock: restarted mid-job';
        }
        this.jobs.set(job.id, job);
      }
    } catch {
      // 无持久化文件或解析失败：忽略
    }
  }

  private persistJobs() {
    // 防抖批量落盘；同时限制条目数（优先保留活跃任务）
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      let entries = [...this.jobs.values()];
      if (entries.length > MAX_PERSISTED_JOBS) {
        const active = entries.filter((j) => j.status === 'pending' || j.status === 'processing');
        const done = entries.filter((j) => j.status !== 'pending' && j.status !== 'processing');
        entries = [...active, ...done.slice(-(MAX_PERSISTED_JOBS - active.length))];
      }
      try {
        mkdirSync(path.dirname(JOB_FILE), { recursive: true });
        writeFileSync(JOB_FILE, JSON.stringify(entries));
      } catch {
        // 落盘失败不影响演示
      }
    }, 500);
  }

  private async cleanupOldAudio() {
    try {
      const files = await readdir(AUDIO_DIR).catch(() => [] as string[]);
      const cutoff = Date.now() - AUDIO_TTL_MS;
      for (const f of files) {
        if (!f.endsWith('.wav')) continue;
        const stat = await import('node:fs/promises').then((m) => m.stat(path.join(AUDIO_DIR, f)));
        if (stat.mtimeMs < cutoff) {
          await rm(path.join(AUDIO_DIR, f), { force: true });
        }
      }
    } catch {
      // 清理失败不影响主流程
    }
  }

  /** 参考音频上传（mock）：不真传，返回假 URL，用于离线演示上传链路 */
  async uploadReferenceFile(file: { base64: string; fileName: string }): Promise<{ downloadUrl: string }> {
    return { downloadUrl: `https://mock.local/audio/refs/${encodeURIComponent(file.fileName)}` };
  }

  async generateMusic(input: GenerateMusicInput): Promise<GenerateResult> {
    const jobId = crypto.randomUUID();
    // 敏感词测试通道：歌词含【敏感词测试】时立即失败，用于演示/测试 Agent 修复闭环
    if (input.lyrics?.includes('【敏感词测试】')) {
      this.jobs.set(jobId, {
        id: jobId,
        status: 'failed',
        progress: 100,
        stage: '内容审核未通过',
        error: 'SENSITIVE_WORD_ERROR：歌词包含敏感表述',
      });
      this.persistJobs();
      return { jobId };
    }
    this.jobs.set(jobId, { id: jobId, status: 'pending', progress: 0, stage: '排队中' });
    void this.runJob(jobId, input, `gen:${jobId}`);
    return { jobId };
  }

  async extend(input: ExtendInput): Promise<GenerateResult> {
    if (input.direction === 'start') {
      // 与真实后端行为保持一致：sunoapi 不支持前置延长
      throw new UnsupportedFeatureError(this.id, 'extend:start（前置延长）');
    }
    const jobId = crypto.randomUUID();
    this.jobs.set(jobId, { id: jobId, status: 'pending', progress: 0, stage: '排队中' });
    void this.runJob(jobId, { title: input.title ?? 'Extended' }, `extend:${input.audioId}:${jobId}`);
    return { jobId };
  }

  async cover(input: IterationInput): Promise<GenerateResult> {
    const jobId = crypto.randomUUID();
    this.jobs.set(jobId, { id: jobId, status: 'pending', progress: 0, stage: '排队中' });
    void this.runJob(jobId, { title: input.title ?? 'Cover' }, `cover:${input.audioId}:${jobId}`);
    return { jobId };
  }

  async replaceSection(input: ReplaceSectionInput): Promise<GenerateResult> {
    const jobId = crypto.randomUUID();
    this.jobs.set(jobId, { id: jobId, status: 'pending', progress: 0, stage: '排队中' });
    void this.runJob(jobId, { title: input.title ?? 'Edited' }, `replace:${input.audioId}:${jobId}`);
    return { jobId };
  }

  async getJob(jobId: string): Promise<JobInfo<SongVariant[]>> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return {
        id: jobId,
        status: 'failed',
        progress: 100,
        stage: '任务已失效',
        error: 'job not found（服务重启后内存任务会丢失，属 P0 已知限制）',
      };
    }
    return job;
  }

  private async runJob(jobId: string, input: { title: string }, seedSalt: string) {
    const update = (patch: Partial<JobInfo<SongVariant[]>>) => {
      const cur = this.jobs.get(jobId);
      if (cur) {
        this.jobs.set(jobId, { ...cur, ...patch });
        this.persistJobs();
      }
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // 模拟 Suno 的异步生成节奏：排队 → 多阶段推进 → 完成
    const steps: Array<[string, number]> = [
      ['分析歌曲结构与风格', 15],
      ['编写和弦进行', 30],
      ['合成旋律与人声', 55],
      ['渲染音频', 75],
      ['混音与母带', 92],
    ];

    try {
      await wait(700);
      update({ status: 'processing' });
      for (const [stage, progress] of steps) {
        await wait(900 + Math.random() * 800);
        update({ status: 'processing', progress, stage });
      }

      await mkdir(AUDIO_DIR, { recursive: true });
      const variants: SongVariant[] = [];
      for (let vIdx = 0; vIdx < 2; vIdx++) {
        const wav = synthesizeWav(hashStr(`${seedSalt}:v${vIdx}`));
        const file = `${jobId}-v${vIdx}.wav`;
        await writeFile(path.join(AUDIO_DIR, file), wav);
        variants.push({
          id: `v${vIdx}`,
          audioUrl: `/generated/${file}`,
          title: input.title,
          durationSec: DURATION_SEC,
          audioId: `mock:${jobId}:${vIdx}`,
        });
      }
      update({ status: 'success', progress: 100, stage: '完成', result: variants });
    } catch (e) {
      update({ status: 'failed', progress: 100, stage: '生成失败', error: String(e) });
    }
  }
}
