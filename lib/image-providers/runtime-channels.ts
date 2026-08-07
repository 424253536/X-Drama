import { registerImageProvider } from './registry';
import type { ImageGenerateInput } from './types';
import { listRuntimeApiChannelsSync } from '@/lib/runtime-api-channels';
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

registerImageProvider({
  id: 'runtime-image-channels',
  name: '用户图像渠道链',
  supportsRefs: true,
  maxRefImages: 3,
  priority: 20,
  available: () => listRuntimeApiChannelsSync('image').length > 0,
  async generate(input) {
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
