/**
 * GET /api/projects/[id]/cost (v12.190) — 项目成本下钻(cost_log × rollupByEngine)。
 * 读免鉴权(与 health/pull-sheet GET 同哲学,按 projectId 作用域,不含 PII)。
 */
import { NextResponse } from 'next/server';
import { listCostLogByProject } from '@/lib/repos/cost-log-repo';
import { rollupByEngine } from '@/lib/cost-rollup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await listCostLogByProject(id);
  const byEngine = rollupByEngine(rows);
  const totalCny = Number(rows.reduce((t, r) => t + (Number(r.costCny) || 0), 0).toFixed(2));
  return NextResponse.json({ projectId: id, totalCny, entries: rows.length, byEngine });
}
