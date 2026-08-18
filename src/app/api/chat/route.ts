import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { addSessionListener, messageText, queuePrompt } from '@/lib/agent/pi';
import { db, schema } from '@/lib/db';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TOOL_EVENTS = new Set(['generate_music', 'extend_music', 'cover_music', 'replace_section']);

interface ToolRecord {
  toolName: string;
  title?: string;
  jobId?: string;
  songId?: string;
  isError?: boolean;
}

// pi Agent SSE 桥：POST { text, chatId } → queuePrompt()（串行化，防事件串流），
// 事件经 hub 广播映射为 SSE：
//   event: delta_chunk data: { text }    助手增量文本
//   event: delta       data: { text }    助手完整文本兜底（客户端仅在无增量时应用）
//   event: tool_start  data: { toolName, args }
//   event: tool_end    data: { toolName, result, isError }
//   event: done / error
// 会话持久化：user/assistant 消息写穿透到 messages 表（chatId 维度）。
// 心跳：每 15s 发 SSE 注释帧（客户端空闲看门狗据此判定断线）。
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = checkRateLimit(`chat:${ip}`, { limit: 12, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: '请求太频繁，请稍后再试（限流 12 次/分钟）' }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { text?: string; chatId?: string };
  if (!body?.text?.trim()) {
    return Response.json({ error: 'empty prompt' }, { status: 400 });
  }
  const chatId = body.chatId ?? 'default';
  const userText = body.text.trim();
  const now = new Date();

  // 会话与用户消息落库（会话行 upsert）
  const chat = (await db.select().from(schema.chats).where(eq(schema.chats.id, chatId)))[0];
  if (!chat) {
    await db.insert(schema.chats).values({
      id: chatId,
      title: userText.slice(0, 30),
      createdAt: now,
    });
  }
  await db.insert(schema.messages).values({
    id: crypto.randomUUID(),
    chatId,
    role: 'user',
    content: JSON.stringify({ text: userText }),
    createdAt: now,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // 连接已关闭，忽略
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };

      // 心跳：SSE 注释帧，客户端任何字节都重置空闲计时
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          // 已关闭
        }
      }, 15_000);

      // 失败跟踪：LLM 流失败会被 pi 静默吞掉（prompt 正常 resolve），
      // 用 auto_retry_end 失败事件 + 输出是否为空来识别，避免「空气泡 + done」
      let sawRetryFailure = false;
      let retryError: string | undefined;
      let sawOutput = false;
      let assistantText = '';
      const toolsByCall = new Map<string, ToolRecord>();

      const off = addSessionListener((ev) => {
        switch (ev.type) {
          case 'message_update': {
            if ((ev.message as { role?: string }).role !== 'assistant') break;
            const ae = ev.assistantMessageEvent as { type?: string; delta?: string };
            if (ae?.type === 'text_delta' && typeof ae.delta === 'string') {
              sawOutput = true;
              assistantText += ae.delta;
              send('delta_chunk', { text: ae.delta });
            }
            break;
          }
          case 'message_end': {
            if ((ev.message as { role?: string }).role !== 'assistant') break;
            const t = messageText(ev.message);
            if (t) {
              sawOutput = true;
              // 累积多段助手消息（方案文本 + 生成后确认），避免后一段覆盖前一段
              if (!assistantText.includes(t)) {
                assistantText = assistantText ? `${assistantText}\n\n${t}` : t;
              }
              send('delta', { text: t });
            }
            break;
          }
          case 'tool_execution_start':
            if (TOOL_EVENTS.has(ev.toolName)) {
              sawOutput = true;
              toolsByCall.set(ev.toolCallId, {
                toolName: ev.toolName,
                title: (ev.args as { title?: string })?.title,
              });
              send('tool_start', { toolName: ev.toolName, args: ev.args });
            }
            break;
          case 'tool_execution_end':
            if (TOOL_EVENTS.has(ev.toolName)) {
              sawOutput = true;
              const rec = toolsByCall.get(ev.toolCallId);
              const details = (ev.result as { details?: unknown })?.details as {
                jobId?: string;
                songId?: string;
              };
              if (rec) {
                rec.jobId = details?.jobId;
                rec.songId = details?.songId;
                rec.isError = ev.isError;
              }
              send('tool_end', {
                toolName: ev.toolName,
                result: details,
                isError: ev.isError,
              });
            }
            break;
          case 'auto_retry_end':
            if (!ev.success) {
              sawRetryFailure = true;
              retryError = ev.finalError;
            }
            break;
          default:
            break;
        }
      });

      try {
        await queuePrompt(userText);
        // 助手消息持久化（文本 + 工具卡片）
        await db.insert(schema.messages).values({
          id: crypto.randomUUID(),
          chatId,
          role: 'assistant',
          content: JSON.stringify({ text: assistantText, tools: [...toolsByCall.values()] }),
          createdAt: new Date(),
        });
        if (sawRetryFailure && !sawOutput) {
          send('error', { message: retryError ?? '生成失败（模型未返回内容）' });
        } else if (!sawOutput) {
          send('error', { message: '模型未返回内容，请稍后重试' });
        } else {
          send('done', {});
        }
      } catch (e) {
        send('error', { message: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(heartbeat);
        off();
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
