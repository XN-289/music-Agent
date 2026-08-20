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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Copy, Download, ExternalLink, GitBranch, Layers, Loader2, Pause, Play, Scissors, Wand2 } from "lucide-react";

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
  childVersions,
}: {
  song: SongDetailData;
  jobId: string | null;
  lrc: LyricsLine[];
  parent: SongDetailData | null;
  childVersions: SongDetailData[];
}) {
  const router = useRouter();
  const [variantIdx, setVariantIdx] = useState(0);
  const current = usePlayerStore((s) => s.current);
  const playing = usePlayerStore((s) => s.playing);
  const progressSec = usePlayerStore((s) => s.progressSec);
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
  const [copied, setCopied] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushSuccess, setPushSuccess] = useState(false);

  // 实时进度（M3）：轮询过程中用本地状态刷新进度条，服务端 props 只在终态时刷新
  const [live, setLive] = useState<{ progress: number; stage: string } | null>(null);
  const iterAbortRef = useRef<AbortController | null>(null);

  // 卸载时中止进行中的迭代轮询
  useEffect(() => {
    return () => iterAbortRef.current?.abort();
  }, []);

  // 生成中：轮询 job，实时刷新进度；完成/失败后刷新服务端组件拿到最新数据
  useEffect(() => {
    if (song.status !== "processing" || !jobId) return;
    let cancelled = false;
    const controller = new AbortController();
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
      { intervalMs: 3000, signal: controller.signal },
    ).catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
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

  async function pushToFolia() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushError(null);
    setPushSuccess(false);
    try {
      const res = await fetch(`/api/songs/${song.id}/push-folia`, { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        foliaWebUrl?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
      setPushSuccess(true);
      if (data.foliaWebUrl) {
        window.open(data.foliaWebUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setPushError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
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
        <div className="mt-6">
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
              <p className="text-xs tabular-nums text-muted-foreground">
                {Math.round(active.durationSec)}s
              </p>
            </div>
          </div>
          <div className="mt-5">
            <WaveformPlayer key={active.id} url={active.audioUrl} variantId={active.id} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
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
            {active && (
              <a
                href={active.audioUrl}
                download={`${song.title}-${active.id}.mp3`}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" /> 下载
              </a>
            )}
          </div>
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
            <Button
              variant="outline"
              size="sm"
              disabled={song.status !== "done" || pushBusy}
              title="推送到 Folia Stage 并打开"
              onClick={() => void pushToFolia()}
            >
              {pushBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              推送并打开 Folia
            </Button>
          </div>
          {iterError && <p className="text-sm text-destructive">{iterError}</p>}
          {pushError && <p className="text-sm text-destructive">{pushError}</p>}
          {pushSuccess && <p className="text-sm text-emerald-600">已推送，Folia 窗口已打开</p>}
          {song.lyrics && (
            <div className="mt-8 border-t pt-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                歌词
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(song.lyrics ?? "");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  <Copy className="h-3 w-3" />
                  {copied ? "已复制" : "复制"}
                </Button>
              </h2>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {song.lyrics}
              </p>
            </div>
          )}

          {/* 版本树 */}
          {(parent || childVersions.length > 0) && (
            <div className="mt-8 border-t pt-4">
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
                {childVersions.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {childVersions.map((c) => (
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
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>延长歌曲</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmitExtend} className="space-y-3">
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
        </DialogContent>
      </Dialog>

      {/* Cover 对话框 */}
      <Dialog open={coverOpen} onOpenChange={setCoverOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>翻唱 / 重混</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmitCover} className="space-y-3">
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
        </DialogContent>
      </Dialog>

      {/* 替换段落对话框 */}
      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>替换段落</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmitReplace} className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="number"
                  value={replaceStart}
                  onChange={(e) => setReplaceStart(e.target.value)}
                  placeholder="起始秒，如 10"
                  min={0}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 text-[11px]"
                  onClick={() => setReplaceStart(String(Math.max(0, Math.round(progressSec))))}
                  title="取当前播放位置"
                >
                  ⏱ 取当前
                </Button>
              </div>
              <div className="relative flex-1">
                <Input
                  type="number"
                  value={replaceEnd}
                  onChange={(e) => setReplaceEnd(e.target.value)}
                  placeholder="结束秒，如 20"
                  min={1}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 text-[11px]"
                  onClick={() => setReplaceEnd(String(Math.max(1, Math.round(progressSec))))}
                  title="取当前播放位置"
                >
                  ⏱ 取当前
                </Button>
              </div>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
