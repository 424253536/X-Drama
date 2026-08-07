/**
 * v12.265 — config.ts 渠道兜底:OPENAI_API_KEY 缺席时,API_CONFIG.openai 三元组
 * (apiKey/baseURL/model) 自动落到 API 路由台最高优先级的 openai 格式文本渠道。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { API_CONFIG } from '@/lib/config';

const CHANNELS = JSON.stringify([
  {
    id: 'ch-2', type: 'text', format: 'openai', enabled: true, priority: 20,
    name: '备用站', apiKey: 'sk-backup', baseUrl: 'https://backup.example.com/v1', model: 'gpt-backup', createdAt: '2026-01-02',
  },
  {
    id: 'ch-1', type: 'text', format: 'openai', enabled: true, priority: 1,
    name: '主站', apiKey: 'sk-channel', baseUrl: 'https://ooioo.work/v1/', model: 'gpt-5.6-sol', createdAt: '2026-01-01',
  },
  {
    id: 'ch-3', type: 'text', format: 'anthropic', enabled: true, priority: 0,
    name: '不参与(非openai格式)', apiKey: 'sk-claude', baseUrl: 'https://a.example.com', model: 'claude-x', createdAt: '2026-01-03',
  },
]);

describe('v12.265 · API_CONFIG.openai 渠道兜底', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', '');
    vi.stubEnv('OPENAI_MODEL', '');
    vi.stubEnv('CREATIVE_API_KEY', '');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    vi.stubEnv('OPENAI_CREATIVE_MODEL', '');
    vi.stubEnv('OPENAI_CREATIVE_FAST_MODEL', '');
    vi.stubEnv('QFMJ_RUNTIME_API_CHANNELS', CHANNELS);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('env 缺 key → 三元组整体取最高优先级 openai 文本渠道(P1, 尾斜杠剥掉)', () => {
    expect(API_CONFIG.openai.apiKey).toBe('sk-channel');
    expect(API_CONFIG.openai.baseURL).toBe('https://ooioo.work/v1');
    expect(API_CONFIG.openai.model).toBe('gpt-5.6-sol');
  });

  it('创意档同样跟渠道走(避免 deepseek 默认模型发去渠道网关 404)', () => {
    expect(API_CONFIG.openai.creativeApiKey).toBe('sk-channel');
    expect(API_CONFIG.openai.creativeBaseURL).toBe('https://ooioo.work/v1');
    expect(API_CONFIG.openai.creativeModel).toBe('gpt-5.6-sol');
    expect(API_CONFIG.openai.creativeFastModel).toBe('gpt-5.6-sol');
  });

  it('env 配了 OPENAI_API_KEY → env 优先, 渠道不干扰', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-env');
    expect(API_CONFIG.openai.apiKey).toBe('sk-env');
    expect(API_CONFIG.openai.baseURL).toBe('https://api.openai.com/v1');
    expect(API_CONFIG.openai.model).toBe('claude-sonnet-4-6');
    expect(API_CONFIG.openai.creativeModel).toBe('deepseek-v4-pro');
  });

  it('无渠道且无 env → 维持原默认(空 key)', () => {
    vi.stubEnv('QFMJ_RUNTIME_API_CHANNELS', '[]');
    expect(API_CONFIG.openai.apiKey).toBe('');
    expect(API_CONFIG.openai.baseURL).toBe('https://api.openai.com/v1');
    expect(API_CONFIG.openai.model).toBe('claude-sonnet-4-6');
  });

  it('坏 JSON / 停用渠道 → 安全回退, 不抛异常', () => {
    vi.stubEnv('QFMJ_RUNTIME_API_CHANNELS', 'not-json{');
    expect(API_CONFIG.openai.apiKey).toBe('');
    vi.stubEnv('QFMJ_RUNTIME_API_CHANNELS', JSON.stringify([
      { id: 'x', type: 'text', format: 'openai', enabled: false, priority: 1, apiKey: 'sk-off', baseUrl: 'https://x', model: 'm' },
    ]));
    expect(API_CONFIG.openai.apiKey).toBe('');
  });
});
