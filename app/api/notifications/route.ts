/**
 * v3.0 P0.1 — Notifications API.
 *
 * GET /api/notifications?unread=1&limit=N
 *   → { notifications: NotificationRow[], unreadCount: number }
 *
 * POST /api/notifications  body: { action: 'markRead', id?: string }  (id 不传 = markAllRead)
 *   → { updated: N }
 *
 * 鉴权: 都要登录, 按 recipient_user_id 严格隔离.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
// v4.2.5: 读 + 写全走 async repo (DbDriver 双驱动), 不再依赖同步 lib/notifications
import {
  listNotifications,
  countUnread as countUnreadAsync,
  markRead,
  markAllRead,
} from '@/lib/repos/notification-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string | null {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // demo 兜底
  // v12.233(对抗复检收尾):删「无 token 回落 DB 第一个用户」——
  // 那等于匿名即以第一注册用户身份读写,且把行为记到真人头上。
  // 改哨兵:匿名请求查到的永远是空集,既不泄露也不误伤(与 v12.218 同款处理)。
  return '__no_auth__';
}

export async function GET(request: NextRequest) {
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  // v10.5.4 懒 digest:拉通知时顺手检查 —— ≥7 天且本周有创作活动才发周报(fire-and-forget)
  void import('@/lib/weekly-digest').then(({ maybeSendWeeklyDigest }) => maybeSendWeeklyDigest(userId)).catch(() => {});

  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const limitStr = request.nextUrl.searchParams.get('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 30;

  const notifications = await listNotifications(userId, { unreadOnly, limit });
  const unreadCount = await countUnreadAsync(userId);

  return NextResponse.json({ notifications, unreadCount });
}

export async function POST(request: NextRequest) {
  const userId = resolveUserId(request);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { /* allow empty body for markAllRead */ }

  const action = String(body?.action || 'markRead');
  if (action !== 'markRead' && action !== 'markAllRead') {
    return NextResponse.json({ error: `invalid action: ${action}` }, { status: 400 });
  }

  if (action === 'markAllRead' || !body?.id) {
    const n = await markAllRead(userId);
    return NextResponse.json({ updated: n });
  }

  const id = String(body.id);
  const ok = await markRead(id, userId);
  return NextResponse.json({ updated: ok ? 1 : 0 });
}
