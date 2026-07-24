/**
 * Nano Banana(Google Gemini Image)图像 provider —— issue #11 下半。
 *
 * 「Nano Banana」是 Gemini 图像模型的社区叫法。它有两条可达路径,本 provider 都支持:
 *   A. **Google 原生**(用户自己的 `GEMINI_API_KEY`)——
 *      `POST {base}/models/{model}:generateContent`,图像在 `candidates[].content.parts[].inlineData`。
 *   B. **OpenAI 兼容代理**(如 OpenRouter)—— 项目里已有 `openrouter-image.ts` 走这条,
 *      本 provider 不重复造:未配 GEMINI_API_KEY 时直接 `available()===false`,把机会留给已有的
 *      OpenRouter 档(它在内置链尾兜底)。避免两条路都注册导致同一模型被打两次。
 *
 * 与 GPT Image 的关键差异:**Gemini 原生支持图生图**(把参考图作为 inlineData part 一起送),
 * 所以这里 `supportsRefs:true`,能接进项目既有的角色一致性契约(cref/sref/referenceImages)。
 * 这也是 issue 里点名的价值之一 —— 它对 CJK 文字渲染和多语言 prompt 也更稳。
 */
import { registerImageProvider } from './registry';
import type { ImageGenerateInput, AspectRatio } from './types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** 画幅提示 —— Gemini 没有 size 参数,靠 prompt 里的构图描述引导。 */
export function geminiAspectHint(aspect?: AspectRatio): string {
  switch (aspect) {
    case '9:16': return ' Vertical 9:16 portrait composition, full-bleed.';
    case '3:4': return ' Vertical 3:4 portrait composition.';
    case '1:1': return ' Square 1:1 composition.';
    case '2.35:1': return ' Ultra-wide 2.35:1 anamorphic cinematic composition.';
    case '4:3': return ' Classic 4:3 composition.';
    default: return ' Wide 16:9 cinematic composition.';
  }
}

/** 参考图 URL/data-URI → Gemini 的 inlineData part;非法返 null。 */
export async function toInlineDataPart(
  url: string,
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const m = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (m) return { inlineData: { mimeType: m[1], data: m[2] } };
    if (!/^https?:\/\//.test(url)) return null;
    // 外链参考图要真拉下来 —— 走 safeFetch:这是服务端按「可能由用户提供的 URL」主动出站,
    // 不过 SSRF 守卫就等于给自己开了一个新的出站口子(v12.235/236/237 的教训)。
    const { safeFetch } = await import('../ssrf-guard');
    const r = await safeFetch(url, {});
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 12 * 1024 * 1024) return null; // 参考图过大直接放弃(留余量给 payload 上限)
    return { inlineData: { mimeType: ct.split(';')[0].trim(), data: buf.toString('base64') } };
  } catch {
    return null;
  }
}

/** 纯函数:构造 generateContent 请求体(参考图 part 由调用方备好),便于单测。 */
export function buildGeminiImageRequest(
  input: ImageGenerateInput,
  refParts: Array<{ inlineData: { mimeType: string; data: string } }> = [],
): { contents: Array<{ role: string; parts: unknown[] }> } {
  const text = `${input.prompt}${geminiAspectHint(input.aspectRatio)}`;
  return {
    contents: [{ role: 'user', parts: [...refParts, { text }] }],
  };
}

/** 从 generateContent 响应里取第一张图 → data URI;没有则空串。 */
export function extractGeminiImage(data: unknown): string {
  const d = data as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  for (const c of d?.candidates || []) {
    for (const p of c?.content?.parts || []) {
      const inline = p?.inlineData;
      if (inline?.data) return `data:${inline.mimeType || 'image/png'};base64,${inline.data}`;
    }
  }
  return '';
}

export function hasGeminiImage(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.GEMINI_API_KEY;
}

registerImageProvider({
  id: 'gemini-image',
  name: 'Nano Banana (Gemini Image)',
  supportsRefs: true,   // 原生 i2i:参考图作为 inlineData part 与 prompt 同送
  maxRefImages: 3,
  priority: 55,         // 略优于 gpt-image(它能吃参考图,对角色一致性更有用)
  available: () => hasGeminiImage(),
  async generate(input: ImageGenerateInput) {
    const env = process.env;
    const base = (env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
    const model = env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image';
    const key = env.GEMINI_API_KEY || '';

    // 参考图:cref/sref 合进 referenceImages(Gemini 不区分语义,按顺序给)
    const refUrls = [
      ...(input.cref ? [input.cref] : []),
      ...(input.sref ? [input.sref] : []),
      ...(input.referenceImages || []),
    ].filter(Boolean).slice(0, 3);
    const refParts = (await Promise.all(refUrls.map((u) => toInlineDataPart(u)))).filter(
      (p): p is { inlineData: { mimeType: string; data: string } } => !!p,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const r = await fetch(`${base}/models/${model}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(buildGeminiImageRequest(input, refParts)),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`gemini-image ${r.status}: ${txt.slice(0, 160)}`);
      }
      const imageUrl = extractGeminiImage(await r.json());
      if (!imageUrl) throw new Error('gemini-image 响应里没有 inlineData 图像');
      return { imageUrl, provider: 'gemini-image' };
    } finally {
      clearTimeout(timer);
    }
  },
});
