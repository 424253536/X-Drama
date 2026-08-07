import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { executeLLMAttempt } from '@/lib/llm-client';
import {
  getGatewayModel,
  getGatewaySecret,
  markGatewayModelTestResult,
  markGatewayTestResult,
} from '@/lib/model-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/i.test(base) && path.startsWith('/v1/') ? base + path.slice(3) : base + path;
}

function authorized(request: NextRequest): boolean {
  const user = getUserFromRequest(request);
  return !!user?.sub && user.role === 'admin';
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ message: '无权执行测试' }, { status: 403 });
  const body = await request.json() as { gatewayId?: string; gatewayModelId?: string };
  const startedAt = Date.now();
  try {
    if (body.gatewayModelId) {
      const route = await getGatewayModel(body.gatewayModelId);
      if (!route) return NextResponse.json({ message: '渠道模型不存在' }, { status: 404 });
      let detail = '';
      if (route.profile.mediaType === 'text') {
        const format = route.protocol === 'gemini-generate-content'
          ? 'gemini'
          : route.protocol === 'anthropic-messages'
            ? 'anthropic'
            : route.protocol === 'openai-responses' ? 'openai-responses' : 'openai';
        const result = await executeLLMAttempt({
          baseURL: route.gateway.baseUrl,
          apiKey: route.gateway.apiKey,
          model: route.upstreamModelId,
          label: route.gateway.name,
          format,
          options: route.protocolOptions as Record<string, string | number | boolean>,
        }, {
          system: 'Reply with OK only.',
          user: 'ping',
          maxTokens: 8,
          signal: AbortSignal.timeout(Math.min(route.gateway.timeoutMs, 30_000)),
        });
        if (!result.ok) throw new Error(result.error || `HTTP ${result.status || 'error'}`);
        detail = `文本模型响应正常 · ${result.status || 200}`;
      } else {
        const response = await fetch(endpoint(route.gateway.baseUrl, '/v1/models'), {
          headers: { Authorization: `Bearer ${route.gateway.apiKey}` },
          signal: AbortSignal.timeout(Math.min(route.gateway.timeoutMs, 30_000)),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
        const ids = Array.isArray(payload?.data) ? payload.data.map((item: any) => String(item?.id || '')) : [];
        if (ids.length && !ids.includes(route.upstreamModelId)) throw new Error('网关模型列表中未找到该模型 ID');
        detail = ids.length ? '鉴权正常，模型 ID 已在网关目录中确认' : '鉴权正常，网关未返回可核对的模型列表';
      }
      await markGatewayModelTestResult(route.id, true, detail);
      return NextResponse.json({ ok: true, detail, elapsedMs: Date.now() - startedAt });
    }

    if (!body.gatewayId) return NextResponse.json({ message: '缺少渠道 ID' }, { status: 400 });
    const gateway = await getGatewaySecret(body.gatewayId);
    if (!gateway) return NextResponse.json({ message: '渠道不存在' }, { status: 404 });
    const response = await fetch(endpoint(gateway.baseUrl, '/v1/models'), {
      headers: { Authorization: `Bearer ${gateway.apiKey}` },
      signal: AbortSignal.timeout(Math.min(gateway.timeoutMs, 30_000)),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    await markGatewayTestResult(gateway.id, true);
    return NextResponse.json({
      ok: true,
      detail: `连接与鉴权正常 · ${Array.isArray(payload?.data) ? payload.data.length : 0} 个模型`,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (body.gatewayModelId) {
      await markGatewayModelTestResult(body.gatewayModelId, false, error instanceof Error ? error.message : String(error)).catch(() => {});
    } else if (body.gatewayId) {
      await markGatewayTestResult(body.gatewayId, false).catch(() => {});
    }
    return NextResponse.json({
      ok: false,
      detail: error instanceof Error ? error.message : '测试失败',
      elapsedMs: Date.now() - startedAt,
    }, { status: 400 });
  }
}
