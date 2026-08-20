// 开发/演示端点：跳过 LLM 直接触发 Mock 生成，用于 P0 全链路验证和「没有 API key 时的演示」。
// P1 接真实后端后保留（便于测试 Provider），生产可删。
import { submitGeneration } from '@/lib/agent/generate-song';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // 生产环境禁用：本端点无鉴权且直连付费生成（对抗性检验 C1 修复）
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not Found' }, { status: 404 });
  }
  const rl = checkRateLimit(`dev:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: '请求太频繁，请稍后再试' }, { status: 429 });
  }
  const grl = checkRateLimit('global:dev', { limit: 30, windowMs: 60_000 });
  if (!grl.ok) {
    return Response.json({ error: '服务繁忙，请稍后再试' }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as {
    title?: string;
    lyrics?: string;
    styleTags?: string[];
    prompt?: string;
    instrumental?: boolean;
    model?: string;
    duration?: number;
  } | null;

  if (!body?.title || !body?.lyrics) {
    return Response.json({ error: 'title 与 lyrics 必填' }, { status: 400 });
  }

  const { jobId, songId } = await submitGeneration({
    title: body.title,
    lyrics: body.lyrics,
    styleTags: Array.isArray(body.styleTags) ? body.styleTags : ['demo'],
    prompt: body.prompt,
    instrumental: body.instrumental ?? false,
    model: body.model,
    duration: body.duration,
  });

  return Response.json({ jobId, songId });
}
