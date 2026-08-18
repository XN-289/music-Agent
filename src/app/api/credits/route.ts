import { and, count, gte } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { getProvider } from '@/lib/providers';

export const dynamic = 'force-dynamic';

// 额度信息：GET /api/credits
// - mock：不限额度，返回今日生成数
// - sunoapi：尝试查询真实剩余 credits，失败时回退本地统计
export async function GET() {
  const provider = getProvider();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayCount = (
    await db
      .select({ c: count() })
      .from(schema.generationJobs)
      .where(gte(schema.generationJobs.createdAt, dayStart))
  )[0]?.c ?? 0;

  let remaining: number | null = null;
  let error: string | null = null;
  try {
    const credits = await provider.getCredits?.();
    remaining = credits?.credits ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return Response.json({
    provider: provider.id,
    remaining,
    unlimited: provider.id === 'mock',
    todayCount,
    error,
  });
}
