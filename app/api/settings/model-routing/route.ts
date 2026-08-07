import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import {
  MODEL_PROTOCOLS,
  MODEL_TASK_KINDS,
  createGateway,
  createGatewayModel,
  deleteGateway,
  deleteGatewayModel,
  deleteModelProfile,
  listModelRoutingAdmin,
  updateGateway,
  updateGatewayModel,
  updateModelProfile,
  type GatewayModelMutation,
  type GatewayMutation,
  type ProfileMutation,
} from '@/lib/model-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorize(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user?.sub) return { ok: false as const, status: 401, message: '请先登录' };
  if (user.role !== 'admin') {
    return { ok: false as const, status: 403, message: '仅管理员可以修改全局 API 路由' };
  }
  return { ok: true as const, userId: user.sub };
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

async function state() {
  return { ...(await listModelRoutingAdmin()), protocols: MODEL_PROTOCOLS, taskKinds: MODEL_TASK_KINDS };
}

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    return json(await state());
  } catch (error) {
    console.error('[ModelRouting] 读取失败:', error);
    return json({ message: '无法读取模型路由配置' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    const body = await request.json() as {
      resource?: 'gateway' | 'gatewayModel';
      gateway?: GatewayMutation;
      gatewayModel?: GatewayModelMutation;
    };
    if (body.resource === 'gateway' && body.gateway) {
      await createGateway(body.gateway, auth.userId);
    } else if (body.resource === 'gatewayModel' && body.gatewayModel) {
      await createGatewayModel(body.gatewayModel);
    } else {
      return json({ message: '新增资源类型或配置无效' }, 400);
    }
    return json({ ok: true, ...(await state()) }, 201);
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : '新增失败' }, 400);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    const body = await request.json() as {
      resource?: 'gateway' | 'gatewayModel' | 'profile';
      id?: string;
      gateway?: GatewayMutation;
      gatewayModel?: GatewayModelMutation;
      profile?: ProfileMutation;
    };
    if (!body.id) return json({ message: '缺少资源 ID' }, 400);
    if (body.resource === 'gateway' && body.gateway) {
      await updateGateway(body.id, body.gateway, auth.userId);
    } else if (body.resource === 'gatewayModel' && body.gatewayModel) {
      await updateGatewayModel(body.id, body.gatewayModel);
    } else if (body.resource === 'profile' && body.profile) {
      await updateModelProfile(body.id, body.profile);
    } else {
      return json({ message: '更新资源类型或配置无效' }, 400);
    }
    return json({ ok: true, ...(await state()) });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : '更新失败' }, 400);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);
  try {
    const body = await request.json() as { resource?: 'gateway' | 'gatewayModel' | 'profile'; id?: string };
    if (!body.id) return json({ message: '缺少资源 ID' }, 400);
    if (body.resource === 'gateway') await deleteGateway(body.id);
    else if (body.resource === 'gatewayModel') await deleteGatewayModel(body.id);
    else if (body.resource === 'profile') await deleteModelProfile(body.id);
    else return json({ message: '删除资源类型无效' }, 400);
    return json({ ok: true, ...(await state()) });
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : '删除失败' }, 400);
  }
}
