import { nanoid } from 'nanoid';
import { getDbDriver } from './db-driver';
import { decryptRuntimeSecret, encryptRuntimeSecret } from './runtime-secrets';
import {
  API_CHANNEL_TYPES,
  getApiChannelFormat,
  type ApiChannelExtraField,
  type ApiChannelType,
} from './api-channel-types';

const RUNTIME_CHANNELS_ENV = 'QFMJ_RUNTIME_API_CHANNELS';

export interface RuntimeApiChannel {
  id: string;
  type: ApiChannelType;
  name: string;
  format: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: number;
  enabled: boolean;
  options: Record<string, string | number | boolean>;
  secrets: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeApiChannelView extends Omit<RuntimeApiChannel, 'apiKey' | 'secrets'> {
  apiKeyConfigured: boolean;
  maskedApiKey: string | null;
  secretConfigured: Record<string, boolean>;
}

export interface RuntimeApiChannelMutation {
  type: ApiChannelType;
  name: string;
  format: string;
  baseUrl: string;
  apiKey?: string | null;
  model?: string;
  priority?: number;
  enabled?: boolean;
  options?: Record<string, unknown>;
  secrets?: Record<string, string | null | undefined>;
}

interface ChannelRow {
  id: string;
  channel_type: string;
  name: string;
  format: string;
  base_url: string;
  api_key: string;
  model: string;
  priority: number;
  enabled: number | boolean;
  options_json: string;
  secret_json: string;
  created_at: string;
  updated_at: string;
}

function secretScope(id: string, field: 'apiKey' | 'secrets'): string {
  return `api-channel:${id}:${field}`;
}

function maskSecret(value: string): string | null {
  return value ? `•••• ${value.slice(-4)}` : null;
}

function parseObject(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function decodeRow(row: ChannelRow): RuntimeApiChannel {
  const apiKey = row.api_key ? decryptRuntimeSecret(secretScope(row.id, 'apiKey'), row.api_key) : '';
  const secrets = row.secret_json
    ? parseObject(decryptRuntimeSecret(secretScope(row.id, 'secrets'), row.secret_json))
    : {};
  return {
    id: row.id,
    type: row.channel_type as ApiChannelType,
    name: row.name,
    format: row.format,
    baseUrl: row.base_url,
    apiKey,
    model: row.model || '',
    priority: Number(row.priority) || 100,
    enabled: Boolean(row.enabled),
    options: parseObject(row.options_json),
    secrets,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toView(channel: RuntimeApiChannel): RuntimeApiChannelView {
  const definition = getApiChannelFormat(channel.type, channel.format);
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    format: channel.format,
    baseUrl: channel.baseUrl,
    model: channel.model,
    priority: channel.priority,
    enabled: channel.enabled,
    options: channel.options,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    apiKeyConfigured: !!channel.apiKey,
    maskedApiKey: maskSecret(channel.apiKey),
    secretConfigured: Object.fromEntries(
      (definition?.extraFields || [])
        .filter((field) => field.kind === 'secret')
        .map((field) => [field.key, !!channel.secrets[field.key]]),
    ),
  };
}

function normalizeScalar(field: ApiChannelExtraField, raw: unknown): string | number | boolean | undefined {
  if (raw == null || raw === '') return field.defaultValue;
  if (field.kind === 'boolean') return raw === true || raw === 'true' || raw === '1';
  if (field.kind === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${field.label}必须是数字`);
    return value;
  }
  const value = String(raw).trim();
  if (/\r|\n|\0/.test(value)) throw new Error(`${field.label}不能包含换行或空字符`);
  return value || field.defaultValue;
}

function normalizeMutation(
  input: RuntimeApiChannelMutation,
  current?: RuntimeApiChannel,
): Omit<RuntimeApiChannel, 'id' | 'createdAt' | 'updatedAt'> {
  if (!API_CHANNEL_TYPES.includes(input.type)) throw new Error('渠道类型无效');
  const definition = getApiChannelFormat(input.type, input.format);
  if (!definition) throw new Error('渠道格式无效');

  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new Error('渠道名称长度应为 1-80 个字符');
  const baseUrl = String(input.baseUrl || '').trim();
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('Base URL 不是有效 URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Base URL 仅支持 http:// 或 https://');

  const model = String(input.model ?? current?.model ?? '').trim();
  if (definition.modelRequired && !model) throw new Error('该格式必须填写模型 ID');
  if (model.length > 300) throw new Error('模型 ID 过长');

  const priority = Math.trunc(Number(input.priority ?? current?.priority ?? 100));
  if (!Number.isFinite(priority) || priority < 1 || priority > 9999) throw new Error('优先级必须在 1-9999 之间');

  const endpointChanged = !!current && (
    input.format !== current.format || parsed.origin !== new URL(current.baseUrl).origin
  );
  if (endpointChanged && input.apiKey === undefined) {
    throw new Error('更换接口格式或目标域名时必须重新输入 API Key');
  }
  const apiKey = input.apiKey === undefined ? (current?.apiKey || '') : String(input.apiKey || '').trim();
  if (!apiKey) throw new Error('API Key / Access Key 不能为空');
  if (apiKey.length > 8192 || /\r|\n|\0/.test(apiKey)) throw new Error('API Key 格式无效');

  const options: Record<string, string | number | boolean> = {};
  const secrets: Record<string, string> = current && input.format === current.format
    ? { ...current.secrets }
    : {};
  for (const field of definition.extraFields) {
    if (field.kind === 'secret') {
      const incoming = input.secrets?.[field.key];
      if (incoming === null) delete secrets[field.key];
      else if (incoming !== undefined && incoming !== '') {
        const value = String(incoming).trim();
        if (value.length > 8192 || /\r|\n|\0/.test(value)) throw new Error(`${field.label}格式无效`);
        secrets[field.key] = value;
      }
      if (field.required && !secrets[field.key]) throw new Error(`${field.label}不能为空`);
      continue;
    }
    const normalized = normalizeScalar(field, input.options?.[field.key] ?? current?.options[field.key]);
    if (normalized !== undefined) options[field.key] = normalized;
    if (field.required && (normalized === undefined || normalized === '')) throw new Error(`${field.label}不能为空`);
  }

  return {
    type: input.type,
    name,
    format: input.format,
    baseUrl,
    apiKey,
    model,
    priority,
    enabled: input.enabled ?? current?.enabled ?? true,
    options,
    secrets,
  };
}

async function queryChannels(): Promise<RuntimeApiChannel[]> {
  const rows = await getDbDriver().query<ChannelRow>(
    `SELECT id, channel_type, name, format, base_url, api_key, model, priority, enabled,
            options_json, secret_json, created_at, updated_at
       FROM api_channels
      ORDER BY channel_type, priority, created_at`,
  );
  return rows.map(decodeRow);
}

function publishRuntimeChannels(channels: RuntimeApiChannel[]): void {
  process.env[RUNTIME_CHANNELS_ENV] = JSON.stringify(
    channels.filter((channel) => channel.enabled).sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)),
  );
}

export async function loadRuntimeApiChannelsIntoEnv(): Promise<number> {
  try {
    const channels = await queryChannels();
    publishRuntimeChannels(channels);
    return channels.filter((channel) => channel.enabled).length;
  } catch {
    process.env[RUNTIME_CHANNELS_ENV] = '[]';
    return 0;
  }
}

export function listRuntimeApiChannelsSync(type?: ApiChannelType): RuntimeApiChannel[] {
  const channels = (() => {
    try { return JSON.parse(process.env[RUNTIME_CHANNELS_ENV] || '[]') as RuntimeApiChannel[]; }
    catch { return []; }
  })();
  return channels
    .filter((channel) => channel.enabled && (!type || channel.type === type))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}

export async function listRuntimeApiChannelViews(): Promise<RuntimeApiChannelView[]> {
  return (await queryChannels()).map(toView);
}

export async function getRuntimeApiChannel(id: string): Promise<RuntimeApiChannel | null> {
  const row = await getDbDriver().get<ChannelRow>(
    `SELECT id, channel_type, name, format, base_url, api_key, model, priority, enabled,
            options_json, secret_json, created_at, updated_at FROM api_channels WHERE id = ?`,
    [id],
  );
  return row ? decodeRow(row) : null;
}

export async function createRuntimeApiChannel(
  input: RuntimeApiChannelMutation,
  userId: string,
): Promise<RuntimeApiChannelView[]> {
  const normalized = normalizeMutation(input);
  const id = nanoid();
  const now = new Date().toISOString();
  await getDbDriver().run(
    `INSERT INTO api_channels
      (id, channel_type, name, format, base_url, api_key, model, priority, enabled,
       options_json, secret_json, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, normalized.type, normalized.name, normalized.format, normalized.baseUrl,
      encryptRuntimeSecret(secretScope(id, 'apiKey'), normalized.apiKey), normalized.model,
      normalized.priority, normalized.enabled ? 1 : 0, JSON.stringify(normalized.options),
      encryptRuntimeSecret(secretScope(id, 'secrets'), JSON.stringify(normalized.secrets)),
      userId, now, now,
    ],
  );
  await loadRuntimeApiChannelsIntoEnv();
  return listRuntimeApiChannelViews();
}

export async function updateRuntimeApiChannel(
  id: string,
  input: RuntimeApiChannelMutation,
  userId: string,
): Promise<RuntimeApiChannelView[]> {
  const current = await getRuntimeApiChannel(id);
  if (!current) throw new Error('渠道不存在');
  const normalized = normalizeMutation(input, current);
  const now = new Date().toISOString();
  await getDbDriver().run(
    `UPDATE api_channels SET channel_type = ?, name = ?, format = ?, base_url = ?, api_key = ?,
       model = ?, priority = ?, enabled = ?, options_json = ?, secret_json = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`,
    [
      normalized.type, normalized.name, normalized.format, normalized.baseUrl,
      encryptRuntimeSecret(secretScope(id, 'apiKey'), normalized.apiKey), normalized.model,
      normalized.priority, normalized.enabled ? 1 : 0, JSON.stringify(normalized.options),
      encryptRuntimeSecret(secretScope(id, 'secrets'), JSON.stringify(normalized.secrets)),
      userId, now, id,
    ],
  );
  await loadRuntimeApiChannelsIntoEnv();
  return listRuntimeApiChannelViews();
}

export async function deleteRuntimeApiChannel(id: string): Promise<RuntimeApiChannelView[]> {
  const result = await getDbDriver().run('DELETE FROM api_channels WHERE id = ?', [id]);
  if (!result.changes) throw new Error('渠道不存在');
  await loadRuntimeApiChannelsIntoEnv();
  return listRuntimeApiChannelViews();
}
