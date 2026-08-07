import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { API_CHANNEL_FORMATS } from '@/lib/api-channel-types';
import {
  createRuntimeApiChannel,
  deleteRuntimeApiChannel,
  listRuntimeApiChannelViews,
  updateRuntimeApiChannel,
  type RuntimeApiChannelMutation,
} from '@/lib/runtime-api-channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorize(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user?.sub) return { ok: false as const, status: 401, message: '请先登录' };
  if (process.env.NODE_ENV === 'production' && user.role !== 'admin') {
    return { ok: false as const, status: 403, message: '生产环境仅管理员可以修改全局 API 渠道' };
  }
  return { ok: true as const, userId: user.sub };
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    return json({ channels: await listRuntimeApiChannelViews(), formats: API_CHANNEL_FORMATS });
  } catch (error) {
    console.error('[ApiChannels] 读取失败:', error);
    return json({ message: '无法读取 API 渠道' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    const input = await request.json() as RuntimeApiChannelMutation;
    return json({ ok: true, channels: await createRuntimeApiChannel(input, auth.userId) }, 201);
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : '新增渠道失败' }, 400);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    const body = await request.json() as { id?: string; channel?: RuntimeApiChannelMutation };
    if (!body.id || !body.channel) return json({ message: '缺少渠道 ID 或配置' }, 400);
    return json({ ok: true, channels: await updateRuntimeApiChannel(body.id, body.channel, auth.userId) });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : '更新渠道失败' }, 400);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    const body = await request.json() as { id?: string };
    if (!body.id) return json({ message: '缺少渠道 ID' }, 400);
    return json({ ok: true, channels: await deleteRuntimeApiChannel(body.id) });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : '删除渠道失败' }, 400);
  }
}
