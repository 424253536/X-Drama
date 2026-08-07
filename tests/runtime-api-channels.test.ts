import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLLMAttempts, executeLLMAttempt } from '@/lib/llm-client';
import { listRuntimeApiChannelsSync, type RuntimeApiChannel } from '@/lib/runtime-api-channels';

const original = process.env.QFMJ_RUNTIME_API_CHANNELS;

function channel(overrides: Partial<RuntimeApiChannel>): RuntimeApiChannel {
  return {
    id: 'channel-default', type: 'text', name: 'Default', format: 'openai',
    baseUrl: 'https://default.test/v1', apiKey: 'sk-default', model: 'model-default',
    priority: 100, enabled: true, options: {}, secrets: {},
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (original == null) delete process.env.QFMJ_RUNTIME_API_CHANNELS;
  else process.env.QFMJ_RUNTIME_API_CHANNELS = original;
});

describe('runtime API channels', () => {
  it('sorts enabled channels by user priority and places them before legacy LLM attempts', () => {
    process.env.QFMJ_RUNTIME_API_CHANNELS = JSON.stringify([
      channel({ id: 'slow', name: 'P200', priority: 200 }),
      channel({ id: 'disabled', name: 'Disabled', priority: 1, enabled: false }),
      channel({ id: 'fast', name: 'P20', format: 'gemini', priority: 20 }),
    ]);
    expect(listRuntimeApiChannelsSync('text').map((item) => item.id)).toEqual(['fast', 'slow']);

    const attempts = buildLLMAttempts(false, {
      baseURL: 'https://legacy.test/v1', apiKey: 'legacy-key', model: 'legacy-model', altModels: [],
      fallbackApiKey: '', openrouterApiKey: '',
    });
    expect(attempts.slice(0, 3).map((item) => item.channelId || item.label)).toEqual(['fast', 'slow', '通用']);
  });

  it('executes OpenAI chat format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'openai-ok' }, finish_reason: 'stop' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeLLMAttempt({
      baseURL: 'https://openai.test/v1', apiKey: 'key', model: 'gpt-test', label: 'openai', format: 'openai',
    }, { system: 'system', user: 'user', maxTokens: 20 });
    expect(result.content).toBe('openai-ok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://openai.test/v1/chat/completions');
  });

  it('executes Gemini generateContent format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'gemini-ok' }] }, finishReason: 'STOP' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeLLMAttempt({
      baseURL: 'https://gemini.test/v1beta', apiKey: 'key', model: 'gemini-test', label: 'gemini', format: 'gemini',
    }, { system: 'system', user: 'user', maxTokens: 20, jsonMode: true });
    expect(result.content).toBe('gemini-ok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://gemini.test/v1beta/models/gemini-test:generateContent');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'key' });
  });

  it('executes Anthropic Messages format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'anthropic-ok' }], stop_reason: 'end_turn',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await executeLLMAttempt({
      baseURL: 'https://anthropic.test/v1', apiKey: 'key', model: 'claude-test', label: 'anthropic',
      format: 'anthropic', options: { anthropicVersion: '2023-06-01' },
    }, { system: 'system', user: 'user', maxTokens: 20 });
    expect(result.content).toBe('anthropic-ok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://anthropic.test/v1/messages');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-api-key': 'key' });
  });
});

