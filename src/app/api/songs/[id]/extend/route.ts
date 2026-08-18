import { getProvider, UnsupportedFeatureError } from '@/lib/providers';
import { commitIteration, resolveSongForIteration } from '@/lib/agent/generate-song';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 直接迭代通道（不走 Agent 对话）：延长歌曲。
// POST { direction?: 'start'|'end', prompt?, contextSeconds? } → { jobId, songId }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rl = checkRateLimit(`iterate:${clientIp(req)}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: '请求太频繁，请稍后再试（限流 10 次/分钟）' }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as {
    direction?: string;
    prompt?: string;
    contextSeconds?: number;
  } | null;

  try {
    const { variant } = await resolveSongForIteration(id);
    const provider = getProvider();
    // contextSeconds 是「参考原曲结尾多少秒」，sunoapi 的 continueAt 是续写起点 → 换算
    const continueAt =
      typeof body?.contextSeconds === 'number' && body.contextSeconds > 0
        ? Math.max(1, Math.round((variant.durationSec || 24) - body.contextSeconds))
        : undefined;
    const { jobId } = await provider.extend({
      audioId: variant.audioId!,
      direction: body?.direction === 'start' ? 'start' : 'end',
      prompt: body?.prompt,
      contextSeconds: body?.contextSeconds,
      continueAt,
      title: `${variant.title} (Extended)`,
      sourceAudioUrl: variant.audioUrl,
    });
    const { songId } = await commitIteration(
      id,
      { title: `${variant.title} (Extended)`, prompt: body?.prompt },
      jobId,
      provider.id,
    );
    return Response.json({ jobId, songId });
  } catch (e) {
    if (e instanceof UnsupportedFeatureError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: msg.startsWith('歌曲不存在') ? 404 : 400 });
  }
}
