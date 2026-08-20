import { getProvider } from '@/lib/providers';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 参考音频上传：客户端 multipart 文件 → provider 托管（sunoapi 临时存储 3 天）→ 公开 URL。
// 校验在转发前完成（类型/大小），上传本身免费但按 IP 限流防滥用。
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = checkRateLimit(`upload:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: '请求太频繁，请稍后再试（限流 10 次/分钟）' }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: '缺少文件字段' }, { status: 400 });
  }
  if (!file.type.startsWith('audio/')) {
    return Response.json({ error: '只支持音频文件' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: '文件过大（≤10MB）' }, { status: 413 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { downloadUrl } = await getProvider().uploadReferenceFile({
      base64: buf.toString('base64'),
      fileName: file.name,
    });
    return Response.json({ url: downloadUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `上传失败：${message}` }, { status: 502 });
  }
}
