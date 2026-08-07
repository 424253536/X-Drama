import { registerImageProvider } from './registry';
import type { ImageGenerateInput } from './types';
import { listRuntimeApiChannelsSync } from '@/lib/runtime-api-channels';
import {
  listRuntimeModelRoutesSync,
  mergeRouteParameters,
  resolveModelRoutesSync,
  runModelRouteChain,
  type RuntimeModelRoute,
} from '@/lib/model-routing';
import {
  buildGeminiImageRequest,
  extractGeminiImage,
  toInlineDataPart,
} from './gemini-image';
import { buildGptImageRequest, extractGptImageUrl } from './openai-gpt-image';

function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/i.test(base) && path.startsWith('/v1/') ? base + path.slice(3) : base + path;
}

async function generateOpenAI(channel: ReturnType<typeof listRuntimeApiChannelsSync>[number], input: ImageGenerateInput) {
  const response = await fetch(apiUrl(channel.baseUrl, '/v1/images/generations'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${channel.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGptImageRequest(input, { ...process.env, OPENAI_IMAGE_MODEL: channel.model })),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
  const imageUrl = extractGptImageUrl(payload);
  if (!imageUrl) throw new Error('响应中没有图像');
  return imageUrl;
}

async function generateGemini(channel: ReturnType<typeof listRuntimeApiChannelsSync>[number], input: ImageGenerateInput) {
  const refUrls = [
    ...(input.cref ? [input.cref] : []),
    ...(input.sref ? [input.sref] : []),
    ...(input.referenceImages || []),
  ].filter(Boolean).slice(0, 3);
  const refParts = (await Promise.all(refUrls.map((url) => toInlineDataPart(url))))
    .filter((part): part is { inlineData: { mimeType: string; data: string } } => !!part);
  const base = channel.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/models/${encodeURIComponent(channel.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': channel.apiKey },
    body: JSON.stringify(buildGeminiImageRequest(input, refParts)),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
  const imageUrl = extractGeminiImage(payload);
  if (!imageUrl) throw new Error('响应中没有图像');
  return imageUrl;
}

async function generateOpenAIRoute(route: RuntimeModelRoute, input: ImageGenerateInput) {
  const path = route.endpointPathOverride || '/v1/images/generations';
  const parameters = mergeRouteParameters(route, {});
  const response = await fetch(apiUrl(route.gateway.baseUrl, path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${route.gateway.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...buildGptImageRequest(input, { ...process.env, OPENAI_IMAGE_MODEL: route.upstreamModelId }),
      ...parameters,
      model: route.upstreamModelId,
    }),
    signal: AbortSignal.timeout(route.gateway.timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
  const imageUrl = extractGptImageUrl(payload);
  if (!imageUrl) throw new Error('响应中没有图像');
  return imageUrl;
}

async function generateGeminiRoute(route: RuntimeModelRoute, input: ImageGenerateInput) {
  const refUrls = [
    ...(input.cref ? [input.cref] : []),
    ...(input.sref ? [input.sref] : []),
    ...(input.referenceImages || []),
  ].filter(Boolean).slice(0, 3);
  const refParts = (await Promise.all(refUrls.map((url) => toInlineDataPart(url))))
    .filter((part): part is { inlineData: { mimeType: string; data: string } } => !!part);
  const defaultPath = `/models/${encodeURIComponent(route.upstreamModelId)}:generateContent`;
  const response = await fetch(apiUrl(route.gateway.baseUrl, route.endpointPathOverride || defaultPath), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${route.gateway.apiKey}`,
      'Content-Type': 'application/json',
      'x-goog-api-key': route.gateway.apiKey,
    },
    body: JSON.stringify(buildGeminiImageRequest(input, refParts)),
    signal: AbortSignal.timeout(route.gateway.timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
  const imageUrl = extractGeminiImage(payload);
  if (!imageUrl) throw new Error('响应中没有图像');
  return imageUrl;
}

registerImageProvider({
  id: 'runtime-image-channels',
  name: '用户图像渠道链',
  supportsRefs: true,
  maxRefImages: 3,
  priority: 20,
  available: () => listRuntimeModelRoutesSync('image').length > 0 || listRuntimeApiChannelsSync('image').length > 0,
  async generate(input) {
    if (input.modelKey) {
      const routes = resolveModelRoutesSync(input.modelKey, 'image', input.taskKind || 'image.default');
      const imageUrl = await runModelRouteChain(routes, async (route) => {
        if (route.protocol === 'gemini-image') return generateGeminiRoute(route, input);
        if (route.protocol === 'openai-images') return generateOpenAIRoute(route, input);
        throw new Error(`不支持的图像协议: ${route.protocol}`);
      }, {
        operation: 'image.generate', taskKind: input.taskKind || 'image.default',
        projectId: input.projectId, userId: input.userId,
        requestParameters: {
          aspectRatio: input.aspectRatio,
          referenceImageCount: [input.cref, input.sref, ...(input.referenceImages || [])].filter(Boolean).length,
        },
      });
      return { imageUrl, provider: `model:${input.modelKey}` };
    }

    const refCount = [input.cref, input.sref, ...(input.referenceImages || [])].filter(Boolean).length;
    const errors: string[] = [];
    for (const channel of listRuntimeApiChannelsSync('image')) {
      if (refCount > 0 && channel.format === 'openai') continue;
      try {
        const imageUrl = channel.format === 'gemini'
          ? await generateGemini(channel, input)
          : await generateOpenAI(channel, input);
        return { imageUrl, provider: `channel:${channel.id}` };
      } catch (error) {
        errors.push(`${channel.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(errors.join(' | ') || '没有兼容当前参考图要求的自定义图像渠道');
  },
});
