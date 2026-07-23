/**
 * POST /api/templates/shared/[token]/clone · v2.18 P2.3
 *
 * 把分享链接背后的模板克隆到当前用户的个人模板库 (global_assets type='template').
 * 要求 auth (匿名用户拿到的 demo-user id 也算).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../../auth/lib';
import { createGlobalAsset } from '@/lib/repos/global-asset-repo'; // v9.0.3b: async, 双驱动
import {
  getTemplateAssetForToken,
  incrementCloneCount,
} from '@/lib/template-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // v12.233(对抗复检收尾):删「无 token 回落 DB 第一个用户」——
  // 那等于匿名即以第一注册用户身份读写,且把行为记到真人头上。
  // 改哨兵:匿名请求查到的永远是空集,既不泄露也不误伤(与 v12.218 同款处理)。
  return '__no_auth__';
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const userId = resolveUserId(request);
  const { token } = await params;

  const found = await getTemplateAssetForToken(token);
  if (!found) {
    return NextResponse.json({ error: '分享链接不存在或已过期' }, { status: 404 });
  }

  // 不允许把自己分享的模板再克隆给自己 (但不阻塞 — 业务上可能有人想保留 multiple 副本, 留个 warning 即可)
  const isSelfClone = found.token.ownerUserId === userId;

  // 取自定义命名 (可选)
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }
  const customName = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';

  const baseName = customName || `${found.asset.name} (克隆自分享)`;

  try {
    const newAsset = await createGlobalAsset({
      userId,
      type: 'template',
      name: baseName,
      description: found.asset.description,
      tags: [...(found.asset.tags || []), '克隆自分享'],
      metadata: {
        ...(found.asset.metadata || {}),
        clonedFromShareToken: token,
        clonedFromAssetId: found.asset.id,
        clonedAt: new Date().toISOString(),
      },
    });
    await incrementCloneCount(token);
    return NextResponse.json({
      newAssetId: newAsset.id,
      newAssetName: newAsset.name,
      isSelfClone,
    });
  } catch (e) {
    console.error('[shared-template-clone] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '克隆失败' },
      { status: 500 },
    );
  }
}
