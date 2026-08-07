import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import {
  isPlaceholder, classifyHttp, classifyMinimax, extractGatewayBalance, overallHealth,
  type ProviderHealth, type ProviderKind,
} from '@/lib/provider-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT = 10_000;
const CACHE_TTL = 60_000;
let cache: { at: number; payload: any } | null = null;

async function timedFetch(url: string, opts: RequestInit = {}): Promise<{ httpStatus?: number; body?: string; error?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    return { httpStatus: res.status, body: await res.text() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(t); }
}

function tryJson(s?: string): any { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/** 一个 provider 探测 — 返回 ProviderHealth, 永不回传 key. */
async function probeChatLLM(id: string, label: string, baseUrl: string, key: string | undefined, model: string): Promise<ProviderHealth> {
  const base = { id, label, kind: 'llm' as ProviderKind, baseUrl };
  if (isPlaceholder(key)) return { ...base, status: 'not_configured', detail: '未配置 key' };
  const t0 = Date.now();
  const r = await timedFetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  });
  const j = tryJson(r.body);
  const cls = j?.base_resp ? classifyMinimax(j.base_resp) : classifyHttp(r);
  return { ...base, ...cls, latencyMs: Date.now() - t0 };
}

async function probeMinimaxTTS(): Promise<ProviderHealth> {
  const base = { id: 'minimax-tts', label: 'MiniMax TTS (兜底·主走 vectorengine)', kind: 'tts' as ProviderKind, baseUrl: process.env.MINIMAX_BASE_URL };
  const key = process.env.MINIMAX_API_KEY;
  if (isPlaceholder(key)) return { ...base, status: 'not_configured', detail: '未设置 MINIMAX_API_KEY' };
  // v7.0.1: 新 sk-cp- key 走 t2a_v2 无需 GroupId; 用账户 plan 支持的模型 (speech-02-hd)
  const t0 = Date.now();
  const ttsModel = process.env.MINIMAX_TTS_MODEL || 'speech-02-hd';
  const r = await timedFetch(`${process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com'}/v1/t2a_v2`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: ttsModel, text: '测试', stream: false, voice_setting: { voice_id: 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 }, audio_setting: { format: 'mp3' } }),
  });
  const j = tryJson(r.body);
  const cls = j?.base_resp ? classifyMinimax(j.base_resp) : classifyHttp(r);
  return { ...base, ...cls, latencyMs: Date.now() - t0 };
}

async function probeGateway(id: string, label: string, baseUrl: string, key?: string): Promise<ProviderHealth> {
  const base = { id, label, kind: 'gateway' as ProviderKind, baseUrl };
  if (isPlaceholder(key)) return { ...base, status: 'not_configured', detail: '未设置 API Key' };
  const auth = { Authorization: `Bearer ${key}` };
  const t0 = Date.now();
  const [models, sub, usage] = await Promise.all([
    timedFetch(`${baseUrl}/v1/models`, { headers: auth }),
    timedFetch(`${baseUrl}/v1/dashboard/billing/subscription`, { headers: auth }),
    timedFetch(`${baseUrl}/v1/dashboard/billing/usage?start_date=2020-01-01&end_date=2099-01-01`, { headers: auth }),
  ]);
  const cls = classifyHttp(models);
  const subJ = tryJson(sub.body);
  const usageJ = tryJson(usage.body);
  const balance = extractGatewayBalance(subJ, typeof usageJ?.total_usage === 'number' ? usageJ.total_usage : undefined);
  return { ...base, ...cls, balance, latencyMs: Date.now() - t0 };
}

function openAIModelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

async function probeMediaGateway(
  id: string,
  label: string,
  kind: ProviderKind,
  baseUrl: string,
  key?: string,
): Promise<ProviderHealth> {
  const base = { id, label, kind, baseUrl };
  if (isPlaceholder(key)) return { ...base, status: 'not_configured', detail: '未设置 API Key' };
  const t0 = Date.now();
  const result = await timedFetch(openAIModelsUrl(baseUrl), {
    headers: { Authorization: `Bearer ${key}` },
  });
  return { ...base, ...classifyHttp(result), latencyMs: Date.now() - t0 };
}

function probeSeedanceDirect(): ProviderHealth {
  const base = {
    id: 'seedance-volcengine',
    label: 'Seedance 火山引擎格式',
    kind: 'video' as ProviderKind,
    baseUrl: process.env.JIMENG_BASE_URL || 'https://visual.volcengineapi.com',
  };
  const ak = process.env.JIMENG_AK;
  const sk = process.env.JIMENG_SK;
  if (isPlaceholder(ak) && isPlaceholder(sk)) {
    return { ...base, status: 'not_configured', detail: '未设置 JIMENG_AK / JIMENG_SK' };
  }
  if (isPlaceholder(ak) || isPlaceholder(sk)) {
    return { ...base, status: 'misconfigured', detail: 'JIMENG_AK 与 JIMENG_SK 必须成对配置' };
  }
  return { ...base, status: 'ok', detail: 'Volc4 凭据已配置；生成任务时执行真实签名验证' };
}

/** 可选/未接入的 provider — 仅看 key 是否配置, 不打网络. */
function optionalProvider(id: string, label: string, kind: ProviderKind, key?: string): ProviderHealth | null {
  if (!isPlaceholder(key)) return null; // 已配置的会单独探测
  return { id, label, kind, status: 'not_configured', detail: '未接入 (可选)' };
}

export async function GET(request: NextRequest) {
  // v12.218(安全止血):此端点暴露所有 provider 的 baseUrl(含内部网关域名)/余额/密钥状态,不该匿名。
  const _g = requireUser(request);
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const fresh = request.nextUrl.searchParams.get('fresh') === '1';
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json({ ...cache.payload, cached: true });
  }

  // v6.9: vectorengine = 补全网关 (TTS/MJ/Kling). 探测用 VECTORENGINE_* (回退 KELING_*)
  const veBase = process.env.VECTORENGINE_BASE_URL || process.env.KELING_BASE_URL || 'https://api.vectorengine.ai';
  const veKey = process.env.VECTORENGINE_API_KEY || process.env.KELING_API_KEY || process.env.VEO_API_KEY;

  // v7.0: 三条 LLM 线 —— 通用(主网关) / 创意(编剧/导演) / MiniMax 全局兜底
  // ⚠️ 探针的 base/key 解析必须与 lib/config.ts 的 creativeBaseURL/creativeApiKey 同序,
  // 否则探针用错 key 会误报 auth_error(实际生成是好的)。两处都是 CREATIVE_* 优先。
  const creativeBase = process.env.CREATIVE_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1';
  const creativeKey = process.env.CREATIVE_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  const fbBase = process.env.LLM_FALLBACK_BASE_URL || 'https://api.minimaxi.com/v1';
  const fbKey = process.env.LLM_FALLBACK_API_KEY || process.env.MINIMAX_API_KEY;
  const openAIImageEnabled = ['1', 'true'].includes((process.env.OPENAI_IMAGE_ENABLED || '').toLowerCase());

  const probes = await Promise.all([
    probeChatLLM('primary-llm', `通用 LLM · ${process.env.OPENAI_MODEL || '?'}`, process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1', process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || 'claude-sonnet-4-6'),
    probeChatLLM('creative-llm', `创意 LLM · ${process.env.OPENAI_CREATIVE_MODEL || 'deepseek-v4-pro'} (编剧/导演)`, creativeBase, creativeKey, process.env.OPENAI_CREATIVE_MODEL || 'deepseek-v4-pro'),
    probeChatLLM('minimax-llm-fallback', `MiniMax LLM 兜底 · ${process.env.LLM_FALLBACK_MODEL || 'MiniMax-M2.7'}`, fbBase, fbKey, process.env.LLM_FALLBACK_MODEL || 'MiniMax-M2.7'),
    probeMinimaxTTS(),
    probeGateway('qingyuntop', 'qingyuntop 网关 (Vidu/聚合视频)', process.env.QINGYUNTOP_BASE_URL || 'https://api.qingyuntop.top', process.env.QINGYUNTOP_API_KEY),
    probeGateway('vectorengine', 'vectorengine 网关 (补全: TTS/MJ/Kling/图像)', veBase, veKey),
    probeMediaGateway(
      'openai-image',
      `OpenAI / New API 图像 · ${process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'}`,
      'image',
      process.env.OPENAI_IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      openAIImageEnabled ? (process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY) : undefined,
    ),
    probeMediaGateway(
      'video-gateway',
      `视频网关 · ${process.env.VEO_MODEL || 'veo3.1-pro'}`,
      'video',
      process.env.VEO_BASE_URL || 'https://api.qingyuntop.top',
      process.env.VEO_API_KEY,
    ),
    process.env.TTS_API_FORMAT === 'volcengine'
      ? Promise.resolve<ProviderHealth>({
          id: 'tts-gateway',
          label: '火山引擎 TTS',
          kind: 'tts',
          baseUrl: process.env.TTS_BASE_URL || 'https://openspeech.bytedance.com',
          status: !isPlaceholder(process.env.TTS_API_KEY) && !!process.env.TTS_APP_ID ? 'ok' : 'not_configured',
          detail: !isPlaceholder(process.env.TTS_API_KEY) && !!process.env.TTS_APP_ID
            ? 'App ID 与访问令牌已配置'
            : '需配置 TTS_API_KEY 与 TTS_APP_ID',
        })
      : probeMediaGateway(
          'tts-gateway',
          `OpenAI / New API 配音 · ${process.env.TTS_MODEL || process.env.VE_TTS_MODEL || 'gpt-4o-mini-tts'}`,
          'tts',
          process.env.TTS_BASE_URL || process.env.VECTORENGINE_BASE_URL || 'https://api.vectorengine.ai',
          process.env.TTS_API_KEY || process.env.VECTORENGINE_API_KEY || process.env.KELING_API_KEY,
        ),
    Promise.resolve(probeSeedanceDirect()),
  ]);

  // 未接入的可选 provider (仅提示)
  const optionals = [
    optionalProvider('midjourney', 'Midjourney (图像)', 'image', process.env.MJ_API_KEY),
    optionalProvider('fal-flux', 'fal / FLUX (图像一致性)', 'image', process.env.FAL_KEY),
    optionalProvider('elevenlabs', 'ElevenLabs (配音)', 'tts', process.env.ELEVENLABS_API_KEY),
    optionalProvider('runway', 'Runway (视频)', 'video', process.env.RUNWAY_API_KEY),
  ].filter(Boolean) as ProviderHealth[];

  const providers = [...probes, ...optionals];
  const payload = {
    overall: overallHealth(probes), // 整体只看已配置的核心 provider
    checkedAt: new Date().toISOString(),
    providers,
  };
  cache = { at: Date.now(), payload };
  return NextResponse.json({ ...payload, cached: false });
}
