// 全局播放器：单例 audio 元素 + zustand 状态（跨页面常驻 PlayerBar 使用）。
// 调研要点：HTMLAudioElement 必须全局单例（不能每渲染重建）、跨源需 crossOrigin、
// 自动播放策略要求 play() 由用户手势触发并 catch 拒绝。
import { create } from "zustand";

export interface NowPlaying {
  songId: string;
  variantId: string;
  url: string;
  title: string;
}

interface PlayerState {
  current: NowPlaying | null;
  playing: boolean;
  /** 当前播放进度（秒），由 timeupdate 事件驱动 */
  progressSec: number;
  durationSec: number;
  play: (np: NowPlaying) => void;
  toggle: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  stop: () => void;
}

// 单例 audio：模块级创建一次，任何页面/组件共享同一个元素。
// 详情页 wavesurfer 通过 media 选项复用此元素，避免双 audio 抢播。
let audioEl: HTMLAudioElement | null = null;

export function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null; // SSR 安全
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "metadata";
  }
  return audioEl;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  current: null,
  playing: false,
  progressSec: 0,
  durationSec: 0,

  play: (np) => {
    const audio = getAudio();
    if (!audio) return;
    const { current, playing } = get();
    // 点同一首 → 切换播放/暂停；换歌 → 换源播放
    if (current?.variantId === np.variantId) {
      if (playing) {
        audio.pause();
        set({ playing: false });
      } else {
        audio.play().catch(() => set({ playing: false }));
        set({ playing: true });
      }
      return;
    }
    audio.src = np.url;
    audio.currentTime = 0;
    audio.play().catch(() => set({ playing: false }));
    set({ current: np, playing: true, progressSec: 0, durationSec: 0 });
  },

  toggle: () => {
    const { current, playing, pause } = get();
    const audio = getAudio();
    if (!current || !audio) return;
    if (playing) pause();
    else {
      audio.play().catch(() => set({ playing: false }));
      set({ playing: true });
    }
  },

  pause: () => {
    const audio = getAudio();
    if (!audio) return;
    audio.pause();
    set({ playing: false });
  },

  seek: (sec) => {
    const audio = getAudio();
    if (!audio || !audio.src) return;
    audio.currentTime = sec;
    set({ progressSec: sec });
  },

  stop: () => {
    const audio = getAudio();
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    set({ current: null, playing: false, progressSec: 0, durationSec: 0 });
  },
}));

// 在客户端初始化一次事件监听（幂等；layout 的 PlayerBar 调用）
let eventsInited = false;

export function initPlayerEvents() {
  if (typeof window === "undefined" || eventsInited) return;
  const audio = getAudio();
  if (!audio) return;
  eventsInited = true;

  audio.addEventListener("timeupdate", () => {
    usePlayerStore.setState({ progressSec: audio.currentTime });
  });
  audio.addEventListener("loadedmetadata", () => {
    usePlayerStore.setState({ durationSec: audio.duration || 0 });
  });
  audio.addEventListener("ended", () => {
    usePlayerStore.setState({ playing: false });
  });
  // 音频加载失败（真实后端 URL 过期等）：复位播放态，避免「假播放」
  audio.addEventListener("error", () => {
    usePlayerStore.setState({ playing: false });
  });
}
