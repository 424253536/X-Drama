/**
 * GET /api/projects/[id]/health (v12.153;v12.155 取数抽公共 film-health-io) — 成片全维体检。
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildProjectHealth } from '@/lib/film-health-io';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await buildProjectHealth(id);
  return NextResponse.json({ ...report, probedAt: new Date().toISOString() });
}
