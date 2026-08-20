"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// 方向选项结构化渲染：把助手消息里的「① ② ③ 方向选项」解析成可点击卡片。
// 解析完全容错——识别失败时返回 null，由调用方回退纯文本渲染。
// 不改 harness 输出格式（自然语言输出保持 skill 可移植性），只在 UI 层接住它。

export interface DirectionOption {
  label: string; // ①
  title: string; // 深夜低保真说唱
  tags: string[]; // 标题里括号内的风格标签（可选）
  body: string; // 听感/画面/示例歌词描述
}

export interface DirectionSegment {
  kind: "text" | "options";
  text?: string;
  options?: DirectionOption[];
}

const MARKER_RE = /^\*{0,2}\s*([①②③④⑤⑥⑦⑧]|\d{1,2}[.、])\s*\*{0,2}/;

function parseOptionBlock(raw: string): DirectionOption | null {
  const m = raw.trim().match(MARKER_RE);
  if (!m) return null;
  const withoutMarker = raw.trim().slice(m[0].length).trim();
  const lines = withoutMarker.split("\n");
  // 标题行可能带 markdown 加粗（**① 慢民谣**（…））——直接清掉所有 * 再解析
  const titleRaw = lines[0].replace(/\*/g, "").trim();
  const tagsMatch = titleRaw.match(/[（(]([^）)]+)[）)]\s*$/);
  const tags = tagsMatch
    ? tagsMatch[1]
        .split(/[,，、]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const title = tagsMatch ? titleRaw.slice(0, tagsMatch.index).trim() : titleRaw;
  if (!title) return null;
  return { label: m[1], title, tags, body: lines.slice(1).join("\n").trim() };
}

/** 空行分段 + 标记行识别；需要 ≥2 个方向块才启用卡片渲染 */
export function parseDirectionOptions(text: string): DirectionSegment[] | null {
  const blocks = text.split(/\n\s*\n/);
  const parsed = blocks.map((b) => {
    const opt = parseOptionBlock(b);
    return opt ? ({ kind: "options", option: opt } as const) : ({ kind: "text", text: b } as const);
  });
  if (parsed.filter((p) => p.kind === "options").length < 2) return null;

  const segments: DirectionSegment[] = [];
  let textBuf: string[] = [];
  let optBuf: DirectionOption[] = [];
  const flushText = () => {
    if (textBuf.length) {
      segments.push({ kind: "text", text: textBuf.join("\n\n") });
      textBuf = [];
    }
  };
  const flushOptions = () => {
    if (optBuf.length) {
      segments.push({ kind: "options", options: optBuf });
      optBuf = [];
    }
  };
  for (const p of parsed) {
    if (p.kind === "text") {
      flushOptions();
      textBuf.push(p.text);
    } else {
      flushText();
      optBuf.push(p.option);
    }
  }
  flushOptions();
  flushText();
  return segments;
}

export function DirectionOptionCards({
  segments,
  disabled,
  onSelect,
}: {
  segments: DirectionSegment[];
  disabled: boolean;
  onSelect: (option: DirectionOption) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return seg.text ? (
            <p key={i} className="whitespace-pre-wrap">
              {seg.text}
            </p>
          ) : null;
        }
        return (
          <div key={i} className="flex flex-col gap-2">
            {seg.options!.map((opt) => (
              <button
                key={opt.label + opt.title}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(opt)}
                className={cn(
                  "w-full rounded-lg border bg-card p-3 text-left transition-colors",
                  disabled
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
                    {opt.label}
                  </span>
                  <span className="text-sm font-medium">{opt.title}</span>
                  {opt.tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </span>
                {opt.body && (
                  <span className="mt-1.5 block whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {opt.body}
                  </span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 助手消息渲染入口：能解析出方向选项 → 文本段进气泡、选项段渲染为整宽可点击卡片；
 * 解析失败 → 整体回退普通气泡（与旧行为一致）。
 */
export function AssistantMessageText({
  text,
  disabled,
  onSelectOption,
}: {
  text: string;
  disabled: boolean;
  onSelectOption: (option: DirectionOption) => void;
}) {
  const segments = parseDirectionOptions(text);
  if (!segments) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>;
  }
  return (
    <div className="w-full">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <p key={i} className="mb-2 whitespace-pre-wrap text-sm leading-relaxed">
            {seg.text}
          </p>
        ) : (
          <DirectionOptionCards key={i} segments={[seg]} disabled={disabled} onSelect={onSelectOption} />
        ),
      )}
    </div>
  );
}
