import type { NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';
import { commitIteration, resolveSongForIteration } from '@/lib/agent/generate-song';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 直接迭代通道（不走 Agent 对话）：翻唱 / 重混。
// POST { prompt?, title? } → { jobId, songId }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rl = checkRateLimit(`iterate:${clientIp(req)}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: '请求太频繁，请稍后再试（限流 10 次/分钟）' }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { prompt?: string; title?: string } | null;

  try {
    const { song, variant } = await resolveSongForIteration(id);
    const provider = getProvider();
    // 上传型 cover 需要可公网访问的绝对 URL（mock 的相对路径在 sunoapi 下无意义，仅本地演示用）
    const sourceAudioUrl = variant.audioUrl.startsWith('http')
      ? variant.audioUrl
      : new URL(variant.audioUrl, req.nextUrl.origin).toString();
    const { jobId } = await provider.cover({
      audioId: variant.audioId!,
      sourceAudioUrl,
      styleTags: song.styleTags ?? [],
      prompt: body?.prompt,
      title: body?.title,
    });
    const { songId } = await commitIteration(
      id,
      { title: body?.title ?? `${song.title} (Cover)`, prompt: body?.prompt },
      jobId,
      provider.id,
    );
    return Response.json({ jobId, songId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: msg.startsWith('歌曲不存在') ? 404 : 400 });
  }
}
