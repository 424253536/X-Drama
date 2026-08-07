import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getGatewaySecret, listModelRoutingAdmin } from '@/lib/model-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function endpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user?.sub || user.role !== 'admin') {
    return NextResponse.json({ message: '无权同步模型' }, { status: 403 });
  }
  const { gatewayId } = await request.json() as { gatewayId?: string };
  if (!gatewayId) return NextResponse.json({ message: '缺少渠道 ID' }, { status: 400 });
  const gateway = await getGatewaySecret(gatewayId);
  if (!gateway) return NextResponse.json({ message: '渠道不存在' }, { status: 404 });
  try {
    const response = await fetch(endpoint(gateway.baseUrl), {
      headers: { Authorization: `Bearer ${gateway.apiKey}` },
      signal: AbortSignal.timeout(Math.min(gateway.timeoutMs, 30_000)),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    const modelIds: string[] = Array.isArray(payload?.data)
      ? [...new Set<string>(payload.data.map((item: any) => String(item?.id || '').trim()).filter(Boolean))].sort()
      : [];
    const configured = (await listModelRoutingAdmin()).models
      .filter((model) => model.gatewayId === gatewayId)
      .map((model) => model.upstreamModelId);
    return NextResponse.json({
      ok: true,
      modelIds,
      discovered: modelIds.filter((id) => !configured.includes(id)),
      configuredMissing: configured.filter((id) => !modelIds.includes(id)),
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '同步失败' }, { status: 400 });
  }
}
