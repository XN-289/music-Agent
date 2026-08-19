import { getProvider, UnsupportedFeatureError } from '@/lib/providers';
import { commitIteration, resolveSongForIteration } from '@/lib/agent/generate-song';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 直接迭代通道（不走 Agent 对话）：替换段落（P2-3 UI 启用）。
// POST { prompt, infillStartS, infillEndS } → { jobId, songId }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rl = checkRateLimit(`iterate:${clientIp(req)}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: '请求太频繁，请稍后再试（限流 10 次/分钟）' }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as {
    prompt?: string;
    infillStartS?: number;
    infillEndS?: number;
  } | null;

  try {
    const { song, variant, taskId, providerId, activeProviderId } =
      await resolveSongForIteration(id);
    if (!taskId) throw new Error('缺少原始生成任务信息，无法替换段落');
    if (providerId !== activeProviderId) {
      throw new Error(`该歌曲由 ${providerId} 生成，当前后端是 ${activeProviderId}，无法跨后端迭代`);
    }
    if (
      typeof body?.infillStartS !== 'number' ||
      typeof body?.infillEndS !== 'number' ||
      body.infillStartS >= body.infillEndS ||
      body.infillStartS < 0
    ) {
      throw new Error('请填写有效的替换区间（起始秒 < 结束秒）');
    }
    // 区间上限钳制到歌曲时长，避免提交必然失败的任务烧 credits
    const dur = variant.durationSec || 0;
    if (dur > 0 && body.infillEndS > dur) {
      throw new Error(`替换区间超出歌曲时长（歌曲共 ${dur} 秒）`);
    }
    if (!body.prompt || body.prompt.length > 3000) {
      throw new Error('prompt 必填且 ≤3000 字符');
    }
    const provider = getProvider();
    const { jobId } = await provider.replaceSection({
      audioId: variant.audioId!,
      taskId,
      prompt: body.prompt ?? 'Rewrite this section',
      styleTags: song.styleTags ?? [],
      title: `${song.title} (Edit)`,
      infillStartS: body.infillStartS,
      infillEndS: body.infillEndS,
      fullLyrics: song.lyrics ?? '',
    });
    const { songId } = await commitIteration(
      id,
      { title: `${song.title} (Edit)`, prompt: body.prompt },
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
