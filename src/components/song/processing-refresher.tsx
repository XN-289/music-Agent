"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 曲库实时刷新：存在生成中的歌曲时，每 5 秒 router.refresh() 拉取最新进度（M6 修复）。
export function ProcessingRefresher({ hasProcessing }: { hasProcessing: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [hasProcessing, router]);

  return null;
}
