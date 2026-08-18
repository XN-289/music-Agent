import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

// 会话历史：GET /api/chats/[id]/messages → { messages: [{ id, role, text, tools }] }
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, id))
    .orderBy(asc(schema.messages.createdAt));

  const messages = rows.map((row) => {
    let parsed: { text?: string; tools?: unknown[] } = {};
    try {
      parsed = JSON.parse(row.content);
    } catch {
      parsed = { text: row.content };
    }
    return {
      id: row.id,
      role: row.role,
      text: parsed.text ?? '',
      tools: parsed.tools ?? [],
    };
  });

  return Response.json({ messages });
}
