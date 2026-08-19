"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pollJob } from "@/lib/client";
import type { LyricsLine } from "@/lib/audio/lrc";
import { usePlayerStore } from "@/components/player/player-store";
import { WaveformPlayer } from "@/components/player/waveform-player";
import { LyricsPanel } from "@/components/song/lyrics-panel";
import { SongCard } from "@/components/song/song-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/dialog";
import { ArrowLeft, Copy, GitBranch, Layers, Loader2, Pause, Play, Scissors, Wand2 } from "lucide-react";

export interface SongDetailData {
  id: string;
  title: string;
  lyrics: string | null;
  styleTags: string[] | null;
  prompt: string | null;
  instrumental: boolean;
  status: "draft" | "processing" | "done" | "failed";
  progress: number;
  stage: string | null;
  variants: { id: string; audioUrl: string; title: string; durationSec: number; audioId?: string }[] | null;
  error: string | null;
  createdAt: number;
}

export function SongDetailClient({
  song,
  jobId,
  lrc,
  parent,
  children,
}: {
  song: SongDetailData;
  jobId: string | null;
  lrc: LyricsLine[];
  parent: SongDetailData | null;
  children: SongDetailData[];
}) {
  const router = useRouter();
  const [variantIdx, setVariantIdx] = useState(0);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const play = usePlayerStore((s) => s.play);
  const toggle = usePlayerStore((s) => s.toggle);

  // 迭代对话框状态
  const [extendOpen, setExtendOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [busy, setBusy] = useState<"extend" | "cover" | "replace" | null>(null);
  const [extPrompt, setExtPrompt] = useState("");
  const [coverPrompt, setCoverPrompt] = useState("");
  const [coverTitle, setCoverTitle] = useState("");
  const [replacePrompt, setReplacePrompt] = useState("");
  const [replaceStart, setReplaceStart] = useState("");
  const [replaceEnd, setReplaceEnd] = useState("");
  const [iterError, setIterError] = useState<string | null>(null);

  // 实时进度（M3）：轮询过程中用本地状态刷新进度条，服务端 props 只在终态时刷新
  const [live, setLive] = useState<{ progress: number; stage: string } | null>(null);
  const iterAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLive(null);
  }, [song.id, song.status]);

  // 卸载时中止进行中的迭代轮询
  useEffect(() => {
    return () => iterAbortRef.current?.abort();
  }, []);

  // 生成中：轮询 job，实时刷新进度；完成/失败后刷新服务端组件拿到最新数据
  useEffect(() => {
    if (song.status !== "processing" || !jobId) return;
    let cancelled = false;
    pollJob(
      jobId,
      (r) => {
        if (cancelled) return;
        if (r.job.status === "success" || r.job.status === "failed") {
          router.refresh();
        } else {
          setLive({ progress: r.job.progress, stage: r.job.stage });
        }
      },
      { intervalMs: 3000 },
    ).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [song.status, jobId, router]);

  async function runIteration(
    kind: "extend" | "cover" | "replace",
    body: Record<string, unknown>,
  ) {
    setBusy(kind);
    setIterError(null);
    const controller = new AbortController();
    iterAbortRef.current = controller;
    try {
      const endpoint = kind === "replace" ? "replace-section" : kind;
      const res = await fetch(`/api/songs/${song.id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await res.json()) as { jobId?: string; songId?: string; error?: string };
      if (!res.ok || !data.jobId) throw new Error(data.error ?? `请求失败（${res.status}）`);
      // 等待子歌曲生成完成再刷新（真实后端约 2-3 分钟）
      await pollJob(data.jobId, () => {}, {
        intervalMs: 5000,
        timeoutMs: 10 * 60 * 1000,
        signal: controller.signal,
      });
      router.refresh();
      setExtendOpen(false);
      setCoverOpen(false);
      setReplaceOpen(false);
      setExtPrompt("");
      setCoverPrompt("");
      setCoverTitle("");
      setReplacePrompt("");
    } catch (e) {
      if (!controller.signal.aborted) {
        // 失败时保留对话框内容，让用户可以直接重试
        setIterError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (iterAbortRef.current === controller) iterAbortRef.current = null;
      setBusy(null);
    }
  }

  function onSubmitExtend(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    void runIteration("extend", { direction: "end", prompt: extPrompt.trim() || undefined });
  }

  function onSubmitCover(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    void runIteration("cover", {
      prompt: coverPrompt.trim() || undefined,
      title: coverTitle.trim() || undefined,
    });
  }

  function onSubmitReplace(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    void runIteration("replace", {
      prompt: replacePrompt.trim() || undefined,
      infillStartS: Number(replaceStart),
      infillEndS: Number(replaceEnd),
    });
  }

  const variants = song.variants ?? [];
  const active = variants[Math.min(variantIdx, variants.length - 1)];
  const activeIsCurrent = active != null && current?.variantId === active.id;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/library"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 返回曲库
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{song.title}</h1>
        {song.styleTags?.map((t) => (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ))}
        {song.instrumental && <Badge variant="secondary">纯音乐</Badge>}
        {song.status === "processing" && (
          <Badge variant="secondary">生成中 {song.progress}%</Badge>
        )}
        {song.status === "failed" && <Badge className="bg-destructive text-white">失败</Badge>}
        {song.status === "done" && parent && <Badge variant="outline">迭代版本</Badge>}
      </div>
      {song.prompt && <p className="mt-1 text-sm text-muted-foreground">{song.prompt}</p>}

      {song.status === "processing" && (
        <div className="mt-6 space-y-2 rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">
            {live?.stage ?? song.stage ?? "排队中…"} · {live?.progress ?? song.progress}%
          </p>
          <Progress value={live?.progress ?? song.progress} />
        </div>
      )}
      {song.status === "failed" && (
        <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">生成失败：{song.error ?? "未知原因"}</p>
          <Link
            href="/"
            className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            让 Agent 帮你诊断修复 →
          </Link>
        </div>
      )}

      {active && (
        <div className="mt-6 rounded-2xl border bg-card p-6">
          <div className="flex items-center gap-4">
            <Button
              size="icon"
              className="h-12 w-12 rounded-full"
              aria-label={activeIsCurrent && playing ? "暂停" : "播放"}
              onClick={() =>
                activeIsCurrent
                  ? toggle()
                  : play({
                      songId: song.id,
                      variantId: active.id,
                      url: active.audioUrl,
                      title: song.title,
                    })
              }
            >
              {activeIsCurrent && playing ? <Pause /> : <Play />}
            </Button>
            <div>
              <p className="font-medium">{song.title}</p>
              <p className="text-xs text-muted-foreground">
                {Math.round(active.durationSec)}s
                {song.status === "done" ? " · 可迭代（Extend / Cover）" : ""}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <WaveformPlayer key={active.id} url={active.audioUrl} variantId={active.id} />
          </div>
          {variants.length > 1 && (
            <div className="mt-4 flex gap-2">
              {variants.map((v, i) => (
                <Button
                  key={v.id}
                  size="sm"
                  variant={i === variantIdx ? "default" : "outline"}
                  onClick={() => setVariantIdx(i)}
                >
                  {v.id.toUpperCase()}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={song.status !== "done" || busy !== null}
              onClick={() => setExtendOpen(true)}
              title="向后延续歌曲"
            >
              {busy === "extend" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Extend
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={song.status !== "done" || busy !== null}
              onClick={() => setCoverOpen(true)}
              title="换个风格重新演绎"
            >
              {busy === "cover" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              Cover / Remix
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={song.status !== "done" || busy !== null}
              onClick={() => setReplaceOpen(true)}
              title="替换歌曲中的某一段"
            >
              {busy === "replace" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Scissors className="h-3.5 w-3.5" />
              )}
              替换段落
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={song.status !== "done"}
              title="复用这首歌的提示词与风格，创作新歌"
              onClick={() => router.push(`/?reuse=${song.id}`)}
            >
              <Copy className="h-3.5 w-3.5" /> Reuse Prompt
            </Button>
          </div>
          {iterError && <p className="text-sm text-destructive">{iterError}</p>}
          {song.lyrics && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">歌词</h2>
              <p className="whitespace-pre-wrap break-words rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed">
                {song.lyrics}
              </p>
            </div>
          )}

          {/* 版本树 */}
          {(parent || children.length > 0) && (
            <div>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <GitBranch className="h-4 w-4" /> 版本树
              </h2>
              <div className="space-y-3">
                {parent && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">← 来自</span>
                    <div className="max-w-[200px] flex-1">
                      <SongCard
                        song={{
                          id: parent.id,
                          title: parent.title,
                          styleTags: parent.styleTags,
                          status: parent.status,
                          progress: parent.progress,
                          variants: parent.variants,
                          createdAt: parent.createdAt,
                        }}
                      />
                    </div>
                  </div>
                )}
                {children.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {children.map((c) => (
                      <SongCard
                        key={c.id}
                        song={{
                          id: c.id,
                          title: c.title,
                          styleTags: c.styleTags,
                          status: c.status,
                          progress: c.progress,
                          variants: c.variants,
                          createdAt: c.createdAt,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">同步歌词</h2>
          {lrc.length > 0 ? (
            <LyricsPanel lines={lrc} />
          ) : (
            <p className="text-sm text-muted-foreground">暂无时间戳歌词</p>
          )}
        </aside>
      </div>

      {/* Extend 对话框 */}
      <Modal open={extendOpen} onClose={() => setExtendOpen(false)} title="延长歌曲">
        <form onSubmit={onSubmitExtend} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            从歌曲结尾向后延续（约再生成一段）。可选：描述新段落的内容走向。
          </p>
          <Textarea
            value={extPrompt}
            onChange={(e) => setExtPrompt(e.target.value)}
            placeholder="例如：在结尾加一段安静的钢琴收束，渐弱结束"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setExtendOpen(false)}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "extend" ? "生成中…" : "开始延长"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cover 对话框 */}
      <Modal open={coverOpen} onClose={() => setCoverOpen(false)} title="翻唱 / 重混">
        <form onSubmit={onSubmitCover} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            保留歌曲内容，用新的风格重新演绎。可选：新风格描述与新标题。
          </p>
          <Textarea
            value={coverPrompt}
            onChange={(e) => setCoverPrompt(e.target.value)}
            placeholder="例如：改成 lo-fi 慢板、女生气声演唱"
            rows={2}
          />
          <Input
            value={coverTitle}
            onChange={(e) => setCoverTitle(e.target.value)}
            placeholder="翻唱版标题（可选）"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCoverOpen(false)}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "cover" ? "生成中…" : "开始翻唱"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* 替换段落对话框 */}
      <Modal open={replaceOpen} onClose={() => setReplaceOpen(false)} title="替换段落">
        <form onSubmit={onSubmitReplace} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            指定要替换的时间区间（秒），描述新的内容走向。可以在波形上播放定位时间点。
          </p>
          <div className="flex gap-2">
            <Input
              type="number"
              value={replaceStart}
              onChange={(e) => setReplaceStart(e.target.value)}
              placeholder="起始秒，如 10"
              min={0}
            />
            <Input
              type="number"
              value={replaceEnd}
              onChange={(e) => setReplaceEnd(e.target.value)}
              placeholder="结束秒，如 20"
              min={1}
            />
          </div>
          <Textarea
            value={replacePrompt}
            onChange={(e) => setReplacePrompt(e.target.value)}
            placeholder="例如：把这段改成更安静的钢琴段落"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplaceOpen(false)}>
              取消
            </Button>
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "replace" ? "生成中…" : "替换段落"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
