/**
 * GET/POST /api/projects/[id]/review-status · v3.x P0.3 E.3
 *
 * GET → ProjectReviewStatus (含 default 'draft' if no record)
 * POST body: { action: 'submit'|'approve'|'request_changes'|'withdraw', note?: string }
 *   submit → in_review
 *   approve → approved
 *   request_changes → changes_requested (note 必填)
 *   withdraw → draft (撤回, 仅 in_review 状态可)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { getReviewStatus, transitionReviewStatus, type ReviewStatus } from '@/lib/review-status';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string | null {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // v12.218(安全止血):不再回落 DB 首用户,匿名用 sentinel(查空不泄露)
  return '__no_auth__';
}

const ACTION_TO_STATUS: Record<string, ReviewStatus> = {
  submit: 'in_review',
  approve: 'approved',
  request_changes: 'changes_requested',
  withdraw: 'draft',
};

export async function GET(request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):本 GET 此前无鉴权 —— 知道 projectId 即可读取他人项目数据。
  const _g = await requireProjectAccess(request, projectId, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const status = getReviewStatus(projectId);
  return NextResponse.json(status);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const actorId = resolveUserId(request);
  if (!actorId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch { /* allow */ }
  const action = String(body?.action || '');
  const toStatus = ACTION_TO_STATUS[action];
  if (!toStatus) {
    return NextResponse.json({ error: `非法 action: ${action}` }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note : undefined;

  const result = transitionReviewStatus({
    projectId, toStatus, actorUserId: actorId, note,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result.status);
}
