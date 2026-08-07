/**
 * POST /api/settings/api-channels/test — 渠道测活。
 *
 * 入参: { id } (渠道 ID, 已保存的渠道)
 * 出参: { ok, elapsedMs, detail, model?, unsupported? }
 *
 * 测法按类型/格式分层, 诚实标注测到了什么:
 *   text  · openai/gemini/anthropic → 真实小对话 (max_tokens 128, "ping"), 全链路验证 key+模型+网关
 *   image/video/audio · openai 格式 → GET /models 鉴权级检查 (不实际生成, 不产生生成费用)
 *   image · gemini → GET models/{model} 鉴权+模型存在性检查
 *   video/audio · volcengine → 需要 Volc4 签名/专用集群, 暂不支持一键测活
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getRuntimeApiChannel } from '@/lib/runtime-api-channels';
import { executeLLMAttempt } from '@/lib/llm-client';
import { safeFetch } from '@/lib/ssrf-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 20_000;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

function endpoint(baseURL: string, path: string): string {
  const base = baseURL.replace(/\/+$/, '');
  if (/\/v1$/i.test(base) && path.startsWith('/v1/')) return base + path.slice(3);
  return base + path;
}

/** GET /models 鉴权检查 (openai 兼容网关: OpenAI/New API/OpenRouter 均实现) */
async function probeOpenAIModels(baseUrl: string, apiKey: string, signal: AbortSignal) {
  const response = await safeFetch(endpoint(baseUrl, '/v1/models'), {
    headers: { Authorization: `Bearer ${apiKey}` }, signal,
  });
  if (response.ok) return { ok: true, detail: '鉴权通过 (GET /models), 未实际生成' };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, detail: `密钥无效或无权限 (HTTP ${response.status})` };
  }
  const body = await response.text().catch(() => '');
  return { ok: false, detail: `HTTP ${response.status}: ${body.slice(0, 200) || '网关未实现 /models, 无法自动测活'}` };
}

/** Gemini: GET models/{model} 鉴权 + 模型存在性 */
async function probeGeminiModel(baseUrl: string, apiKey: string, model: string, signal: AbortSignal) {
  const base = baseUrl.replace(/\/+$/, '');
  const response = await safeFetch(`${base}/models/${encodeURIComponent(model)}`, {
    headers: { 'x-goog-api-key': apiKey }, signal,
  });
  if (response.ok) return { ok: true, detail: `鉴权通过, 模型 ${model} 存在, 未实际生成` };
  const body = await response.json().catch(() => null);
  return { ok: false, detail: body?.error?.message || `HTTP ${response.status}` };
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user?.sub) return json({ message: '请先登录' }, 401);
  if (process.env.NODE_ENV === 'production' && user.role !== 'admin') {
    return json({ message: '生产环境仅管理员可以测试全局 API 渠道' }, 403);
  }

  let body: { id?: string } = {};
  try { body = await request.json(); } catch {}
  if (!body.id) return json({ message: '缺少渠道 ID' }, 400);

  const channel = await getRuntimeApiChannel(body.id);
  if (!channel) return json({ message: '渠道不存在' }, 404);

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // 文本渠道 → 真实小对话, 全链路验证
    if (channel.type === 'text') {
      const result = await executeLLMAttempt(
        {
          baseURL: channel.baseUrl.replace(/\/+$/, ''),
          apiKey: channel.apiKey,
          model: channel.model,
          label: channel.name,
          format: channel.format as 'openai' | 'gemini' | 'anthropic',
          options: channel.options,
        },
        {
          system: '你是连通性探针, 只回复 pong, 不要输出其它内容。',
          user: 'ping',
          maxTokens: 128,
          temperature: 0,
          signal: controller.signal,
        },
      );
      const elapsedMs = Date.now() - start;
      if (result.ok) {
        return json({ ok: true, elapsedMs, model: channel.model, detail: `真实对话成功 (${elapsedMs} ms)` });
      }
      return json({ ok: false, elapsedMs, detail: result.error || `HTTP ${result.status || '?'}` });
    }

    // 非文本渠道 → 按格式做鉴权级检查 (不触发实际生成, 不产生生成费用)
    if (channel.format === 'volcengine') {
      return json({
        ok: false, unsupported: true, elapsedMs: 0,
        detail: '火山引擎签名格式暂不支持一键测活, 请通过实际生成验证',
      });
    }
    const probe = channel.format === 'gemini'
      ? await probeGeminiModel(channel.baseUrl, channel.apiKey, channel.model || 'gemini-3-pro-image', controller.signal)
      : await probeOpenAIModels(channel.baseUrl, channel.apiKey, controller.signal);
    return json({ ...probe, elapsedMs: Date.now() - start, model: channel.model || undefined });
  } catch (error: any) {
    const detail = error?.name === 'AbortError' ? `超时 (${TIMEOUT_MS / 1000}s)` : (error?.message || String(error));
    return json({ ok: false, elapsedMs: Date.now() - start, detail });
  } finally {
    clearTimeout(timer);
  }
}
