import { randomUUID } from 'crypto';
import { registerTTSProvider } from './registry';
import type { TTSGenerateInput } from './types';
import { listRuntimeApiChannelsSync } from '@/lib/runtime-api-channels';
import { mapVoiceToOpenAI, openAITTSUrl, volcengineTTSUrl } from './vectorengine-tts';

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

registerTTSProvider({
  id: 'runtime-audio-channels',
  name: '用户声音渠道链',
  priority: 20,
  supportsEmotion: false,
  supportsCloning: false,
  supportsStreaming: false,
  maxTextLen: 10_000,
  supportedLanguages: [],
  available: () => listRuntimeApiChannelsSync('audio').length > 0,
  async generate(input) {
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

