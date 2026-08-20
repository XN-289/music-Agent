"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GenerationCard } from "./generation-card";
import { AssistantMessageText } from "./direction-options";
import { ParamsPanel, hasParams, paramsSummary, type PanelParams } from "./params-panel";
import { SongCard, type SongCardData } from "@/components/song/song-card";
import { coverGradient } from "@/lib/cover";
import { cn } from "@/lib/utils";

// 场景入口：来自 harness 场景库（对标海绵「精选/创作」+ Suno 快捷入口结构）
const SCENARIO_CARDS = [
  { emoji: "💔", label: "分手纪念" },
  { emoji: "🌙", label: "深夜一个人听" },
  { emoji: "🎁", label: "生日祝福" },
  { emoji: "📱", label: "短视频 BGM" },
  { emoji: "🚗", label: "开车旅行" },
  { emoji: "🎓", label: "毕业季" },
  { emoji: "🧧", label: "新年祝福" },
  { emoji: "📖", label: "学习专注" },
];
const CHAT_KEY = "music-agent-chat-id";

interface ToolMsg {
  kind: "tool";
  toolCallId: string;
  jobId?: string;
  songId?: string;
  title: string;
  isError?: boolean;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  tool?: ToolMsg;
  params?: PanelParams; // 该条消息携带的面板参数（展示用，服务端持久化 text 不变）
  done: boolean;
}

// SSE 解析：fetch + ReadableStream 手动解析 event/data 块（EventSource 不支持 POST）。
// 容错：CRLF 归一化、残留缓冲在流结束时处理；onActivity 在每次收到字节时回调（心跳看门狗用）。
async function streamChat(
  text: string,
  chatId: string,
  onEvent: (event: string, data: unknown) => void,
  signal: AbortSignal,
  onActivity: () => void,
  referenceAudioUrl?: string,
  params?: PanelParams,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, chatId, referenceAudioUrl, params }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  if (!res.body) throw new Error("无响应流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function dispatch(block: string) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    if (dataLines.length > 0) {
      try {
        onEvent(event, JSON.parse(dataLines.join("\n")));
      } catch {
        // 非法 JSON 跳过
      }
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        dispatch(block);
      }
    }
    if (buffer.trim()) dispatch(buffer); // 末尾无空行的事件
  } finally {
    reader.releaseLock();
  }
}

interface HistoryRow {
  id: string;
  role: "user" | "assistant";
  text: string;
  params?: PanelParams;
  tools?: Array<{
    toolName?: string;
    title?: string;
    jobId?: string;
    songId?: string;
    isError?: boolean;
  }>;
}

export function ChatView({ recentSongs }: { recentSongs?: SongCardData[] }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refAudio, setRefAudio] = useState("");
  const [showRef, setShowRef] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [params, setParams] = useState<PanelParams>({});
  const [showParams, setShowParams] = useState(false);
  const [credits, setCredits] = useState<{
    unlimited?: boolean;
    todayCount?: number;
    remaining?: number | null;
  } | null>(null);

  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [lastPrompt, setLastPrompt] = useState(""); // 重试按钮需要渲染期读取（ref 不参与渲染）
  // 最近一次发送的完整快照（text + 面板参数 + 参考音频），重试时整包复用保证幂等
  const lastSendRef = useRef<{ text: string; params?: PanelParams; refAudio?: string } | null>(null);
  const lastActivityRef = useRef(0);
  const reuseHandledRef = useRef(false);
  // 收到过增量流的消息 id：完整文本兜底（delta）不应覆盖已流式累积的文本
  const streamedRef = useRef(new Set<string>());
  const chatIdRef = useRef<string>("default");
  const searchParams = useSearchParams();

  // Reuse Prompt：从详情页跳转 ?reuse=songId → 预填创作输入（复用提示词与风格）
  useEffect(() => {
    const reuse = searchParams.get("reuse");
    if (!reuse || reuseHandledRef.current) return;
    reuseHandledRef.current = true;
    void fetch(`/api/songs/${reuse}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { title?: string; prompt?: string | null; styleTags?: string[] | null } | null) => {
        if (!s?.title) return;
        const tags = s.styleTags?.length ? `（风格标签：${s.styleTags.join(", ")}）` : "";
        setInput(
          `复用《${s.title}》的提示词与风格，创作一首新歌${s.prompt ? `：${s.prompt}` : ""}${tags}`,
        );
      })
      .catch(() => {});
  }, [searchParams]);

  // 会话初始化：localStorage 里的 chatId（SSR 时无 window，挂载后再取）
  useEffect(() => {
    let id = "default";
    try {
      const saved = localStorage.getItem(CHAT_KEY);
      if (saved) id = saved;
      else {
        id = crypto.randomUUID();
        localStorage.setItem(CHAT_KEY, id);
      }
    } catch {
      id = "default";
    }
    chatIdRef.current = id;

    // 历史恢复
    void fetch(`/api/chats/${id}/messages`)
      .then((r) => r.json())
      .then((d: { messages?: HistoryRow[] }) => {
        const rows = d.messages ?? [];
        setMessages(
          rows.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text ?? "",
            params: m.params,
            tool:
              m.tools && m.tools.length > 0
                ? {
                    kind: "tool",
                    toolCallId: `${m.id}-tool`,
                    jobId: m.tools[0].jobId,
                    songId: m.tools[0].songId,
                    title: m.tools[0].title ?? "新歌",
                    isError: m.tools[0].isError,
                  }
                : undefined,
            done: true,
          })),
        );
      })
      .catch(() => {});
    // 额度信息
    void fetch("/api/credits")
      .then((r) => r.json())
      .then(setCredits)
      .catch(() => {});
  }, []);

  // 空闲看门狗：50 秒内无任何字节（含心跳）判定断线，中止请求
  useEffect(() => {
    const t = setInterval(() => {
      if (
        abortRef.current &&
        lastActivityRef.current > 0 &&
        Date.now() - lastActivityRef.current > 50_000
      ) {
        abortRef.current.abort();
      }
    }, 5_000);
    return () => clearInterval(t);
  }, []);

  const patchMsg = (id: string, patch: Partial<ChatMsg>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  async function sendPrompt(
    text: string,
    opts?: { params?: PanelParams | null; refAudio?: string },
  ) {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    setLastPrompt(text.trim());

    // 参数快照：opts.params 显式传 null = 本条消息不带面板参数（如「就选②这个方向」，
    // 方向选择本身就是裁决，避免与面板约束冲突导致气泡谎报）；undefined = 用当前面板值。
    const paramsForSend: PanelParams = opts?.params === null ? {} : { ...(opts?.params ?? params) };
    const refAudioForSend = opts?.refAudio ?? (refAudio.trim() || undefined);
    // 记录完整发送快照，重试时整包复用（幂等：不混入重试时已变更的面板/参考音频）
    lastSendRef.current = {
      text: text.trim(),
      params: hasParams(paramsForSend) ? paramsForSend : undefined,
      refAudio: refAudioForSend,
    };
    const userMsg: ChatMsg = {
      id: `u${++idRef.current}`,
      role: "user",
      text: text.trim(),
      params: hasParams(paramsForSend) ? paramsForSend : undefined,
      done: true,
    };
    const assistantMsg: ChatMsg = { id: `a${++idRef.current}`, role: "assistant", text: "", done: false };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;
    lastActivityRef.current = Date.now();

    try {
      await streamChat(
        text.trim(),
        chatIdRef.current,
        (event, data) => {
          switch (event) {
            case "delta_chunk": {
              const d = data as { text?: string };
              if (typeof d.text !== "string") break;
              streamedRef.current.add(assistantMsg.id);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsg.id ? { ...m, text: m.text + d.text } : m)),
              );
              break;
            }
            case "delta": {
              const d = data as { text?: string };
              if (typeof d.text !== "string") break;
              if (streamedRef.current.has(assistantMsg.id)) break; // 已流式累积，跳过兜底覆盖
              patchMsg(assistantMsg.id, { text: d.text });
              break;
            }
            case "tool_start": {
              const d = data as { args?: { title?: string } };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        tool: {
                          kind: "tool",
                          toolCallId: `t${idRef.current}`,
                          title: d.args?.title ?? "新歌",
                        },
                      }
                    : m,
                ),
              );
              break;
            }
            case "tool_end": {
              const d = data as {
                result?: { jobId?: string; songId?: string };
                isError?: boolean;
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id && m.tool
                    ? {
                        ...m,
                        tool: {
                          ...m.tool,
                          jobId: d.result?.jobId,
                          songId: d.result?.songId,
                          isError: d.isError,
                        },
                      }
                    : m,
                ),
              );
              break;
            }
            case "error": {
              const d = data as { message?: string };
              setError(d.message ?? "生成失败");
              break;
            }
            case "done":
              break;
            default:
              break;
          }
        },
        controller.signal,
        () => {
          lastActivityRef.current = Date.now();
        },
        refAudioForSend,
        hasParams(paramsForSend) ? paramsForSend : undefined,
      );
      patchMsg(assistantMsg.id, { done: true });
    } catch (e) {
      const userAborted = controller.signal.aborted;
      patchMsg(assistantMsg.id, { done: true });
      if (userAborted) {
        // 用户主动停止：不做错误提示
      } else {
        // 不自动重试：无法区分「请求未到达」与「已生成但响应丢失」，
        // 盲目重发可能重复扣费（对抗性检验 C1）。交给用户手动重试并自行判断。
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    void sendPrompt(text);
  }

  function onCancel() {
    abortRef.current?.abort();
  }

  // 参考音频上传：本地文件 → /api/upload-audio（provider 托管）→ 公开 URL 填入参考音频
  const refFileInputRef = useRef<HTMLInputElement>(null);
  async function onPickRefFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // 允许重复选同一个文件
    if (!f) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/upload-audio", { method: "POST", body: fd });
      const d = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !d.url) throw new Error(d.error ?? "上传失败");
      setRefAudio(d.url);
      setShowRef(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function newChat() {
    const id = crypto.randomUUID();
    try {
      localStorage.setItem(CHAT_KEY, id);
    } catch {
      // 忽略
    }
    chatIdRef.current = id;
    setMessages([]);
    setError(null);
    setInput("");
    // 新对话 = 全新上下文：面板参数与参考音频都是消息级约束，不得跨会话泄漏
    setParams({});
    setShowParams(false);
    setRefAudio("");
    setShowRef(false);
    lastSendRef.current = null;
  }

  const isFirst = messages.length === 0;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {credits?.unlimited
            ? `Mock 生成 · 不限额度 · 今日已生成 ${credits.todayCount ?? 0} 首`
            : credits?.remaining != null
              ? `今日 ${credits.todayCount ?? 0} 首 · 剩余 ${credits.remaining} credits`
              : "…"}
        </div>
        <Button variant="ghost" size="sm" onClick={newChat} disabled={sending}>
          + 新对话
        </Button>
      </div>

      {isFirst && (
        <div className="mt-12">
          <h1 className="text-center text-4xl font-bold tracking-tight">
            想做什么<span className="text-primary">歌</span>？
          </h1>

          {/* hero 输入框（Suno 文本主导：输入即主角） */}
          <div className="mx-auto mt-8 max-w-2xl">
            <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/20">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="例如：一首送给妈妈的歌 / 深夜 emo 说唱 / 给毕业写首歌"
                rows={2}
                autoFocus
                className="resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    onSubmit(e);
                  }
                }}
              />
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-xs text-muted-foreground">Enter 发送 · Shift+Enter 换行</span>
                <Button
                  type="button"
                  size="lg"
                  disabled={!input.trim() || sending}
                  onClick={() => {
                    const t = input.trim();
                    if (!t || sending) return;
                    setInput("");
                    void sendPrompt(t);
                  }}
                >
                  {sending ? "生成中…" : "生成"}
                </Button>
              </div>
            </div>
          </div>

          {/* 场景入口（对标海绵精选页结构） */}
          <div className="mt-14">
            <p className="text-xs font-medium tracking-widest text-muted-foreground">场景</p>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {SCENARIO_CARDS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setInput(c.label)}
                  className="group flex flex-col items-start gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${coverGradient(c.label)} text-lg transition-transform group-hover:scale-105`}
                  >
                    {c.emoji}
                  </span>
                  <span className="text-sm">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义参数面板（对标海绵「自定义创作」：曲风/心情/音色直接选，不必打字描述） */}
          <div className="mt-14">
            <p className="text-xs font-medium tracking-widest text-muted-foreground">自定义</p>
            <div className="mt-4">
              <ParamsPanel value={params} onChange={setParams} />
            </div>
          </div>

          {/* 精选（对标海绵「精选 AI 音乐」/ musicmake Sample Works） */}
          {recentSongs && recentSongs.length > 0 && (
            <div className="mt-14">
              <p className="text-xs font-medium tracking-widest text-muted-foreground">精选</p>
              <div className="-mx-4 mt-4 flex gap-3 overflow-x-auto px-4 pb-2">
                {recentSongs.map((s) => (
                  <div key={s.id} className="w-40 shrink-0">
                    <SongCard song={s} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-6">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}
          >
            {m.text.length > 0 &&
              (m.role === "assistant" && m.done ? (
                <AssistantMessageText
                  text={m.text}
                  disabled={sending}
                  onSelectOption={(opt) => {
                    // 方向选择是用户对方向的裁决，本条消息不带面板参数，避免两种约束冲突
                    void sendPrompt(`就选「${opt.title}」这个方向`, { params: null });
                  }}
                />
              ) : m.role === "assistant" ? (
                <p className="max-w-[85%] whitespace-pre-wrap text-sm leading-relaxed">
                  {m.text}
                  {!m.done && <span className="ml-0.5 animate-pulse">▍</span>}
                </p>
              ) : (
                <div className="max-w-[85%] rounded-lg bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.params && hasParams(m.params) && (
                    <p className="mt-1.5 text-xs text-primary-foreground/70">
                      🎛 {paramsSummary(m.params)}
                    </p>
                  )}
                </div>
              ))}
            {m.tool && (
              <div className="w-full">
                {m.tool.jobId && m.tool.songId ? (
                  <GenerationCard jobId={m.tool.jobId} songId={m.tool.songId} title={m.tool.title} />
                ) : m.tool.isError ? (
                  <p className="text-sm text-destructive">❌ {m.tool.title} 生成调用失败</p>
                ) : (
                  <p className="animate-pulse text-sm text-muted-foreground">
                    🎼 正在提交生成任务…
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>出错了：{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // 重试 = 原样重发：整包复用上次发送快照（text + 面板参数 + 参考音频）
              const last = lastSendRef.current;
              if (last) {
                void sendPrompt(last.text, { params: last.params ?? null, refAudio: last.refAudio });
              }
            }}
            disabled={sending || !lastPrompt}
          >
            重试
          </Button>
        </div>
      )}

      {!isFirst && (
        <form onSubmit={onSubmit} className="sticky bottom-2 mt-6 space-y-3">
          <div className="rounded-lg border bg-card p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="描述你想创作的歌，例如：一首关于夏夜散步的 dreamy pop，女生唱的，带一点复古合成器…"
              rows={2}
              className="resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
            />
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-xs text-muted-foreground">Enter 发送 · Shift+Enter 换行</span>
            {sending ? (
              <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                停止
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!input.trim()}>
                生成
              </Button>
            )}
          </div>
            <div className="border-t border-border/60 px-2 pt-2">
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowParams((v) => !v)}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  🎛 参数
                  {hasParams(params) && (
                    <span className="ml-1.5 text-primary">· {paramsSummary(params)}</span>
                  )}{" "}
                  {showParams ? "▲" : "▼"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRef((v) => !v)}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  🎵 参考音频
                  {refAudio.trim() && <span className="ml-1.5 text-primary">· 已加载</span>}{" "}
                  {showRef ? "▲" : "▼"}
                </button>
              </div>
              {showParams && (
                <div className="mt-3">
                  <ParamsPanel value={params} onChange={setParams} />
                </div>
              )}
              {showRef && (
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="url"
                    value={refAudio}
                    onChange={(e) => setRefAudio(e.target.value)}
                    placeholder="粘贴参考音频 URL（按它的风格/听感创作，可选）"
                    className="h-8 flex-1 rounded-md border border-input bg-transparent px-3 text-xs text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => refFileInputRef.current?.click()}
                    className="h-8 shrink-0 rounded-md border px-2.5 text-xs transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                  >
                    {uploading ? "上传中…" : "📎 上传文件"}
                  </button>
                  <input
                    ref={refFileInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => void onPickRefFile(e)}
                  />
                </div>
              )}
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
