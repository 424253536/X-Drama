/**
 * GET /api/notifications/stream (v10.2.0) — 通知实时流 (SSE)。
 *
 * 订阅当前用户的 notif 频道:有新通知(评论 @提及 / 回复)即推一帧 → 通知铃实时更新,
 * 取代固定间隔轮询。用户解析与 `/api/notifications` GET 完全一致(Bearer → 否则 demo 兜底
 * 取最早用户),行为零变化、仅多了推送。25s keepalive;客户端断开 → 清理订阅。
 * 帧内只带 {type, commentId, projectId, at},不含内容;前端收到后走原有 GET 取数。
 */
import { db } from '@/lib/db';
import { createSSEResponse } from '@/lib/sse';
import { subscribe, notifChannel } from '@/lib/event-bus';
import { getUserFromRequest } from '../../auth/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string | null {
  const p = getUserFromRequest(request);
  if (p?.sub) return p.sub;
  // v12.233(对抗复检收尾):删「无 token 回落 DB 第一个用户」——
  // 那等于匿名即以第一注册用户身份读写,且把行为记到真人头上。
  // 改哨兵:匿名请求查到的永远是空集,既不泄露也不误伤(与 v12.218 同款处理)。
  return '__no_auth__';
}

export async function GET(request: Request) {
  const userId = resolveUserId(request);
  if (!userId) return new Response('unauthorized', { status: 401 });

  return createSSEResponse(async (send) => {
    send({ event: 'ready', data: { ok: true } });
    const off = subscribe(notifChannel(userId), (ev) => send({ event: 'notification', data: ev }));
    const ping = setInterval(() => send({ event: 'ping', data: { at: Date.now() } }), 25_000);
    await new Promise<void>((resolve) => {
      const done = () => { clearInterval(ping); off(); resolve(); };
      if (request.signal.aborted) return done();
      request.signal.addEventListener('abort', done);
    });
  });
}
