"use client";

import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import { getAudio, usePlayerStore } from "./player-store";

// 详情页波形播放器：wavesurfer 复用全局单例 media 元素（media 选项），
// 播放/进度/点击 seek 全部与 PlayerBar、歌词面板天然同步。
//
// 两个关键修正：
// M1 容器用命令式创建的 inner div（wavesurfer 的 destroy() 会 remove 容器节点，
//    React StrictMode 双执行会把 React 拥有的节点拆掉导致波形不可见）
// M2 只有该波形「拥有播放权」（store.current 指向此变体）或全局空闲时才 load url，
//    避免挂载即换 src 掐断其他正在播放的歌
export function WaveformPlayer({ url, variantId }: { url: string; variantId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = containerRef.current;
    const audio = getAudio();
    if (!host || !audio) return;

    const inner = document.createElement("div");
    host.appendChild(inner);

    const ws = WaveSurfer.create({
      container: inner,
      media: audio,
      height: 96,
      barWidth: 3,
      barGap: 2,
      barRadius: 2,
      waveColor: "#d4d4d8",
      progressColor: "#16a34a",
      cursorColor: "#18181b",
      cursorWidth: 1,
    });

    let loaded = false;
    const syncLoad = () => {
      const current = usePlayerStore.getState().current;
      const canLoad = current == null || current.variantId === variantId;
      if (!canLoad || loaded) return;
      loaded = true;
      void ws.load(url);
    };
    syncLoad();
    const unsub = usePlayerStore.subscribe((s, prev) => {
      if (s.current?.variantId !== prev.current?.variantId) syncLoad();
    });

    ws.on("timeupdate", (t) => {
      usePlayerStore.setState({ progressSec: t, durationSec: ws.getDuration() || 0 });
    });
    ws.on("play", () => usePlayerStore.setState({ playing: true }));
    ws.on("pause", () => usePlayerStore.setState({ playing: false }));
    ws.on("finish", () => usePlayerStore.setState({ playing: false }));
    ws.on("interaction", () => {
      usePlayerStore.setState({ progressSec: ws.getCurrentTime() });
    });

    return () => {
      unsub();
      ws.destroy();
      inner.remove(); // destroy 已移除时是无害的保险
    };
  }, [url, variantId]);

  return <div ref={containerRef} className="w-full" />;
}
