// 内存滑动窗口限流（P2：单实例演示级；多实例需换 Redis 等共享存储）。
// 用法：withRateLimit(key, { limit, windowMs }) → { ok } | { ok: false, retryAfterMs }

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < opts.windowMs);
  if (arr.length >= opts.limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfterMs: opts.windowMs - (now - arr[0]) };
  }
  arr.push(now);
  buckets.set(key, arr);
  // 防止 map 无限增长：定期清理空桶
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || now - v[v.length - 1] > opts.windowMs) buckets.delete(k);
    }
  }
  return { ok: true };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'local';
}
