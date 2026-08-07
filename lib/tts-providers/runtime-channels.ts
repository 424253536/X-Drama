import { randomUUID } from 'crypto';
import { registerTTSProvider } from './registry';
import type { TTSGenerateInput } from './types';
import { listRuntimeApiChannelsSync } from '@/lib/runtime-api-channels';
import { mapVoiceToOpenAI, openAITTSUrl, volcengineTTSUrl } from './vectorengine-tts';
import {
  listRuntimeModelRoutesSync,
  mergeRouteParameters,
  resolveModelRoutesSync,
  runModelRouteChain,
  type RuntimeModelRoute,
} from '@/lib/model-routing';

function durationFor(text: string): number {
  return Math.max(1, Math.ceil((text || '').length / 4.5));
}

async function generateOpenAI(channel: ReturnType<typeof listRuntimeApiChannelsSync>[number], input: TTSGenerateInput) {
  const response = await fetch(openAITTSUrl(channel.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${channel.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: channel.model,
      input: input.text,
      voice: String(channel.options.voice || mapVoiceToOpenAI(input.voiceId)),
      response_format: 'mp3',
      ...(input.speed ? { speed: input.speed } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('空音频');
  return buffer;
}

async function generateVolcengine(channel: ReturnType<typeof listRuntimeApiChannelsSync>[number], input: TTSGenerateInput) {
  const response = await fetch(volcengineTTSUrl(channel.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer;${channel.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: {
        appid: String(channel.options.appId || ''),
        token: channel.apiKey,
        cluster: String(channel.options.cluster || 'volcano_tts'),
      },
      user: { uid: 'qfmanju' },
      audio: {
        voice_type: String(channel.options.voice || 'BV001_streaming'),
        encoding: 'mp3',
        speed_ratio: input.speed || 1,
        volume_ratio: input.volume || 1,
        pitch_ratio: input.pitch || 1,
      },
      request: { reqid: randomUUID(), text: input.text, text_type: 'plain', operation: 'query' },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code !== 3000 || !payload?.data) {
    throw new Error(`HTTP ${response.status}: ${payload?.message || `code=${payload?.code ?? 'unknown'}`}`);
  }
  const encoded = String(payload.data);
  const buffer = Buffer.from(encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded, 'base64');
  if (!buffer.length) throw new Error('空音频');
  return buffer;
}

async function generateMappedAudio(route: RuntimeModelRoute, input: TTSGenerateInput) {
  const voice = route.voiceMap[input.voiceId]
    || String(route.profile.defaultParameters.voice || route.parametersOverride.voice || mapVoiceToOpenAI(input.voiceId));
  const parameters = mergeRouteParameters(route, {
    speed: input.speed,
    volume: input.volume,
    pitch: input.pitch,
  });
  if (route.protocol === 'openai-audio-speech') {
    const response = await fetch(
      route.endpointPathOverride
        ? new URL(route.endpointPathOverride, `${route.gateway.baseUrl.replace(/\/+$/, '')}/`).toString()
        : openAITTSUrl(route.gateway.baseUrl),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${route.gateway.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: route.upstreamModelId,
          input: input.text,
          voice,
          response_format: String(parameters.response_format || 'mp3'),
          ...(parameters.speed ? { speed: parameters.speed } : {}),
        }),
        signal: AbortSignal.timeout(route.gateway.timeoutMs),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('空音频');
    return buffer;
  }
  if (route.protocol === 'volcengine-tts-bearer') {
    const response = await fetch(
      route.endpointPathOverride
        ? new URL(route.endpointPathOverride, `${route.gateway.baseUrl.replace(/\/+$/, '')}/`).toString()
        : volcengineTTSUrl(route.gateway.baseUrl),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${route.gateway.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: route.upstreamModelId,
          app: {
            appid: String(route.protocolOptions.appId || ''),
            token: route.gateway.apiKey,
            cluster: String(route.protocolOptions.cluster || 'volcano_tts'),
          },
          user: { uid: 'qfmanju' },
          audio: {
            voice_type: voice,
            encoding: String(parameters.encoding || 'mp3'),
            speed_ratio: Number(parameters.speed || input.speed || 1),
            volume_ratio: Number(parameters.volume || input.volume || 1),
            pitch_ratio: Number(parameters.pitch || input.pitch || 1),
          },
          request: { reqid: randomUUID(), text: input.text, text_type: 'plain', operation: 'query' },
        }),
        signal: AbortSignal.timeout(route.gateway.timeoutMs),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || (payload?.code != null && payload.code !== 3000) || !payload?.data) {
      throw new Error(`HTTP ${response.status}: ${payload?.message || `code=${payload?.code ?? 'unknown'}`}`);
    }
    const encoded = String(payload.data);
    const buffer = Buffer.from(encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded, 'base64');
    if (!buffer.length) throw new Error('空音频');
    return buffer;
  }
  throw new Error(`该声音协议不能用于 TTS: ${route.protocol}`);
}

registerTTSProvider({
  id: 'runtime-audio-channels',
  name: '用户声音渠道链',
  priority: 20,
  supportsEmotion: false,
  supportsCloning: false,
  supportsStreaming: false,
  maxTextLen: 10_000,
  supportedLanguages: [],
  available: () => listRuntimeModelRoutesSync('audio').length > 0 || listRuntimeApiChannelsSync('audio').length > 0,
  async generate(input) {
    if (input.modelKey) {
      const routes = resolveModelRoutesSync(input.modelKey, 'audio', input.taskKind || 'audio.tts');
      const buffer = await runModelRouteChain(routes, (route) => generateMappedAudio(route, input), {
        operation: 'audio.tts', taskKind: input.taskKind || 'audio.tts',
        projectId: input.projectId, userId: input.userId,
        requestParameters: { textLength: input.text.length, language: input.language, voiceId: input.voiceId },
      });
      const duration = durationFor(input.text);
      return {
        audioUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`,
        duration,
        subtitle: [{ start: 0, end: duration, text: input.text, character: input.character }],
        provider: `model:${input.modelKey}`,
      };
    }

    const errors: string[] = [];
    for (const channel of listRuntimeApiChannelsSync('audio')) {
      try {
        const buffer = channel.format === 'volcengine'
          ? await generateVolcengine(channel, input)
          : await generateOpenAI(channel, input);
        const duration = durationFor(input.text);
        return {
          audioUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`,
          duration,
          subtitle: [{ start: 0, end: duration, text: input.text, character: input.character }],
          provider: `channel:${channel.id}`,
        };
      } catch (error) {
        errors.push(`${channel.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(errors.join(' | ') || '没有可用的自定义声音渠道');
  },
});
