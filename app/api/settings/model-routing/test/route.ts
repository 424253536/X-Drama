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
  const body = await request.json() as { gatewayId?: string; gatewayModelId?: string; workload?: 'probe' | 'director' };
  const startedAt = Date.now();
  try {
    if (body.gatewayModelId) {
      const route = await getGatewayModel(body.gatewayModelId);
      if (!route) return NextResponse.json({ message: '渠道模型不存在' }, { status: 404 });
      let detail = '';
      if (route.profile.mediaType === 'text') {
        const directorWorkload = body.workload === 'director';
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
          system: directorWorkload
            ? (await import('@/lib/mckee-skill')).getDirectorSystemPrompt()
            : '你是 API 连通性测试助手。必须输出 JSON。',
          user: directorWorkload
            ? '请为一个 30 秒竖屏短剧生成导演方案：一名夜班图书管理员发现一本会记录未来事件的书，并决定阻止即将发生的火灾。只输出完整 JSON。'
            : '返回一个包含 ok=true、message="pipeline-ready"、items=[1,2,3] 的 JSON 对象。',
          maxTokens: directorWorkload ? 16_384 : 256,
          jsonMode: true,
          signal: AbortSignal.timeout(directorWorkload ? 300_000 : Math.min(route.gateway.timeoutMs, 120_000)),
        });
        if (!result.ok) throw new Error(result.error || `HTTP ${result.status || 'error'}`);
        if (!directorWorkload && !/pipeline-ready|"ok"\s*:\s*true/i.test(result.content || '')) {
          throw new Error(`文本模型未返回预期内容: ${(result.content || '').slice(0, 160)}`);
        }
        if (directorWorkload && (result.content || '').trim().length < 100) {
          throw new Error(`导演工作负载响应过短: ${(result.content || '').slice(0, 160)}`);
        }
        detail = directorWorkload
          ? `导演工作负载生成正常 · ${result.status || 200} · ${result.content?.length || 0} 字符`
          : `文本生成正常 · ${result.status || 200}`;
      } else if (route.profile.mediaType === 'image') {
        const { generateImageWithRuntimeRoute } = await import('@/lib/image-providers/runtime-channels');
        const { runScheduledModelRoute } = await import('@/lib/model-route-scheduler');
        const imageUrl = await runScheduledModelRoute(route, () => generateImageWithRuntimeRoute(route, {
          prompt: 'A clean cinematic test frame of a red paper lantern on a dark wooden table, no text, no watermark.',
          aspectRatio: '1:1',
          label: 'API 路由台实际生图测试',
        }));
        if (!imageUrl) throw new Error('图像模型没有返回图片');
        detail = `实际图像生成正常 · ${imageUrl.startsWith('data:') ? '内嵌图像' : '图像 URL 已返回'}`;
      } else if (route.profile.mediaType === 'video') {
        const { generateVideoWithRuntimeRoute } = await import('@/lib/video-providers/runtime-channels');
        const result = await generateVideoWithRuntimeRoute(route, {
          prompt: 'A red paper lantern gently sways in a quiet studio, locked camera, cinematic light, no text.',
          durationSec: 5,
          resolution: '480p',
          aspectRatio: '16:9',
          label: 'API 路由台实际视频生成测试',
        });
        if (!result.videoUrl) throw new Error('视频模型没有返回视频');
        detail = `实际视频生成正常 · ${result.upstreamId ? `任务 ${result.upstreamId}` : '视频 URL 已返回'}`;
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
