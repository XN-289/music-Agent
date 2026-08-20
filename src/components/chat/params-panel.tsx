"use client";

import { cn } from "@/lib/utils";
import {
  GENRE_OPTIONS,
  MOOD_OPTIONS,
  PANEL_GROUPS,
  VOCAL_OPTIONS,
  type PanelOptionItem,
} from "@/lib/panel-params";

// 创作参数面板：曲风/心情/音色三组单选（再点一次取消）。
// 选项词表与服务端白名单同源（@/lib/panel-params），客户端渲染的值必然能通过服务端校验。
// 值形如 "流行(pop)"（中文标签 + 英文 tag），服务端拼进提示词数据块。

export interface PanelParams {
  genre?: string;
  mood?: string;
  vocal?: string;
}

const GROUPS = [
  { title: "曲风", options: GENRE_OPTIONS },
  { title: "心情", options: MOOD_OPTIONS },
  { title: "音色", options: VOCAL_OPTIONS },
] as const;

const toParam = (o: PanelOptionItem) => `${o.label}(${o.tag})`;

function PillGroup({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: readonly PanelOptionItem[];
  value?: string;
  onPick: (param: string | undefined) => void;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value === toParam(o);
          return (
            <button
              key={o.tag}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(active ? undefined : toParam(o))}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "hover:border-primary hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ParamsPanel({
  value,
  onChange,
}: {
  value: PanelParams;
  onChange: (p: PanelParams) => void;
}) {
  const hasAny = Boolean(value.genre || value.mood || value.vocal);
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {GROUPS.map((g) => (
        <PillGroup
          key={g.title}
          title={g.title}
          options={g.options}
          value={value[g.title === "曲风" ? "genre" : g.title === "心情" ? "mood" : "vocal"]}
          onPick={(p) =>
            onChange({
              ...value,
              [g.title === "曲风" ? "genre" : g.title === "心情" ? "mood" : "vocal"]: p,
            })
          }
        />
      ))}
      {hasAny && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="w-fit text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline md:col-span-3"
        >
          清空参数
        </button>
      )}
    </div>
  );
}

/** 折叠态/发送提示用的摘要："流行 · 忧郁 · 女声" */
export function paramsSummary(p: PanelParams): string {
  return [p.genre, p.mood, p.vocal]
    .filter((s): s is string => typeof s === "string" && Boolean(s))
    .map((s) => s.replace(/\(.*\)$/, ""))
    .join(" · ");
}

export function hasParams(p: PanelParams): boolean {
  return Boolean(p.genre || p.mood || p.vocal);
}
