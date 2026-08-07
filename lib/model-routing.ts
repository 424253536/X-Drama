import { nanoid } from 'nanoid';
import { getDbDriver, type DbExecutor } from './db-driver';
import { decryptRuntimeSecret, encryptRuntimeSecret } from './runtime-secrets';
import type { ApiChannelType } from './api-channel-types';

export type ModelMediaType = ApiChannelType;
export type ModelStatus = 'active' | 'disabled' | 'revoked';
export type ModelRoutePolicy = 'priority_failover' | 'pinned';
export type AudioStrategy = 'native' | 'separate' | 'hybrid';
export type ModelSelections = Record<string, string>;

export const MODEL_TASK_KINDS = {
  text: ['text.default', 'text.creative', 'text.fast', 'text.vision'],
  image: ['image.default', 'image.reference', 'image.inpaint'],
  video: ['video.default', 'video.first_last_frame', 'video.subject_reference', 'video.lipsync'],
  audio: ['audio.tts', 'audio.music', 'audio.sfx', 'audio.voice_clone', 'audio.stt'],
} as const satisfies Record<ModelMediaType, readonly string[]>;

export const MODEL_PROTOCOLS = {
  text: [
    { id: 'openai-chat', label: 'OpenAI Chat Completions' },
    { id: 'openai-responses', label: 'OpenAI Responses' },
    { id: 'gemini-generate-content', label: 'Gemini generateContent' },
    { id: 'anthropic-messages', label: 'Anthropic Messages' },
  ],
  image: [
    { id: 'openai-images', label: 'OpenAI Images' },
    { id: 'gemini-image', label: 'Gemini Image' },
  ],
  video: [
    { id: 'openai-videos', label: 'OpenAI Videos' },
    { id: 'unified-video', label: 'Unified Video' },
    { id: 'volcengine-video-bearer', label: '火山视频格式（Bearer）' },
    { id: 'volcengine-video-signed', label: '火山视频格式（AK/SK）' },
  ],
  audio: [
    { id: 'openai-audio-speech', label: 'OpenAI Audio Speech' },
    { id: 'openai-audio-transcriptions', label: 'OpenAI Audio Transcriptions' },
    { id: 'volcengine-tts-bearer', label: '火山 TTS 格式（Bearer）' },
    { id: 'volcengine-tts-signed', label: '火山 TTS 格式（AK/SK）' },
    { id: 'newapi-music', label: 'NewAPI Music' },
    { id: 'newapi-sfx', label: 'NewAPI SFX' },
  ],
} as const satisfies Record<ModelMediaType, readonly { id: string; label: string }[]>;

const RUNTIME_MODEL_ROUTES_ENV = 'QFMJ_RUNTIME_MODEL_ROUTES_V2';

export interface ApiGateway {
  id: string;
  name: string;
  kind: 'newapi';
  baseUrl: string;
  apiKey: string;
  authMode: 'bearer';
  enabled: boolean;
  timeoutMs: number;
  configVersion: number;
  keyVersion: number;
  options: Record<string, unknown>;
  lastTestStatus: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiGatewayView extends Omit<ApiGateway, 'apiKey'> {
  apiKeyConfigured: boolean;
  maskedApiKey: string | null;
  modelCount: number;
}

export interface ModelProfile {
  id: string;
  modelKey: string;
  displayName: string;
  mediaType: ModelMediaType;
  status: ModelStatus;
  isDefaultFor: string[];
  sortOrder: number;
  taskKinds: string[];
  capabilitySchemaVersion: number;
  capabilities: Record<string, unknown>;
  defaultParameters: Record<string, unknown>;
  lockedParameters: Record<string, unknown>;
  routePolicy: ModelRoutePolicy;
  pricingPolicy: Record<string, unknown>;
  accessPolicy: Record<string, unknown>;
  limits: Record<string, unknown>;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayModel {
  id: string;
  gatewayId: string;
  modelProfileId: string;
  upstreamModelId: string;
  protocol: string;
  protocolVersion: string;
  adapterVersion: string;
  priority: number;
  status: ModelStatus;
  capabilitiesOverride: Record<string, unknown>;
  parametersOverride: Record<string, unknown>;
  protocolOptions: Record<string, unknown>;
  voiceMap: Record<string, string>;
  pricingOverride: Record<string, unknown>;
  priceVersion: number;
  inputTransport: Record<string, unknown>;
  outputPolicy: Record<string, unknown>;
  endpointPathOverride: string | null;
  configVersion: number;
  lastTestStatus: string | null;
  lastTestDetail: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayModelView extends GatewayModel {
  gatewayName: string;
  modelKey: string;
  displayName: string;
  mediaType: ModelMediaType;
}

export interface RuntimeModelRoute extends GatewayModel {
  gateway: ApiGateway;
  profile: ModelProfile;
}

export interface ModelCatalogItem {
  modelKey: string;
  displayName: string;
  mediaType: ModelMediaType;
  taskKinds: string[];
  isDefaultFor: string[];
  capabilities: Record<string, unknown>;
  defaultParameters: Record<string, unknown>;
  lockedParameters: Record<string, unknown>;
  routePolicy: ModelRoutePolicy;
  routeCount: number;
}

export interface GatewayMutation {
  name: string;
  baseUrl: string;
  apiKey?: string | null;
  enabled?: boolean;
  timeoutMs?: number;
  configVersion?: number;
  options?: Record<string, unknown>;
}

export interface ProfileMutation {
  modelKey: string;
  displayName: string;
  mediaType: ModelMediaType;
  status?: ModelStatus;
  isDefaultFor?: string[];
  sortOrder?: number;
  taskKinds?: string[];
  capabilities?: Record<string, unknown>;
  defaultParameters?: Record<string, unknown>;
  lockedParameters?: Record<string, unknown>;
  routePolicy?: ModelRoutePolicy;
  pricingPolicy?: Record<string, unknown>;
  accessPolicy?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  configVersion?: number;
}

export interface GatewayModelMutation {
  gatewayId: string;
  modelProfileId?: string;
  profile?: ProfileMutation;
  upstreamModelId: string;
  protocol: string;
  priority?: number;
  status?: ModelStatus;
  capabilitiesOverride?: Record<string, unknown>;
  parametersOverride?: Record<string, unknown>;
  protocolOptions?: Record<string, unknown>;
  voiceMap?: Record<string, string>;
  pricingOverride?: Record<string, unknown>;
  endpointPathOverride?: string | null;
  configVersion?: number;
}

interface GatewayRow {
  id: string; name: string; kind: string; base_url: string; api_key_encrypted: string;
  auth_mode: string; enabled: number | boolean; timeout_ms: number; config_version: number;
  key_version: number; options_json: string; last_test_status: string | null;
  last_tested_at: string | null; created_at: string; updated_at: string;
}

interface ProfileRow {
  id: string; model_key: string; display_name: string; media_type: string; status: string;
  is_default_for_json: string; sort_order: number; task_kinds_json: string;
  capability_schema_version: number; capabilities_json: string; default_parameters_json: string;
  locked_parameters_json: string; route_policy: string; pricing_policy_json: string;
  access_policy_json: string; limits_json: string; config_version: number;
  created_at: string; updated_at: string;
}

interface ModelRow {
  id: string; gateway_id: string; model_profile_id: string; upstream_model_id: string;
  protocol: string; protocol_version: string; adapter_version: string; priority: number;
  status: string; capabilities_override_json: string; parameters_override_json: string;
  protocol_options_json: string; voice_map_json: string; pricing_override_json: string;
  price_version: number; input_transport_json: string; output_policy_json: string;
  endpoint_path_override: string | null; config_version: number; last_test_status: string | null;
  last_test_detail: string | null; last_tested_at: string | null; created_at: string; updated_at: string;
}

const gatewayColumns = `id, name, kind, base_url, api_key_encrypted, auth_mode, enabled, timeout_ms,
  config_version, key_version, options_json, last_test_status, last_tested_at, created_at, updated_at`;
const profileColumns = `id, model_key, display_name, media_type, status, is_default_for_json, sort_order,
  task_kinds_json, capability_schema_version, capabilities_json, default_parameters_json,
  locked_parameters_json, route_policy, pricing_policy_json, access_policy_json, limits_json,
  config_version, created_at, updated_at`;
const modelColumns = `id, gateway_id, model_profile_id, upstream_model_id, protocol, protocol_version,
  adapter_version, priority, status, capabilities_override_json, parameters_override_json,
  protocol_options_json, voice_map_json, pricing_override_json, price_version, input_transport_json,
  output_policy_json, endpoint_path_override, config_version, last_test_status, last_test_detail,
  last_tested_at, created_at, updated_at`;

function gatewaySecretScope(id: string): string {
  return `api-gateway:${id}:apiKey`;
}

function parseObject(value: string | null | undefined): Record<string, any> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function parseArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function normalizeObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`);
  return value as Record<string, unknown>;
}

function decodeGateway(row: GatewayRow): ApiGateway {
  return {
    id: row.id, name: row.name, kind: 'newapi', baseUrl: row.base_url,
    apiKey: row.api_key_encrypted ? decryptRuntimeSecret(gatewaySecretScope(row.id), row.api_key_encrypted) : '',
    authMode: 'bearer', enabled: Boolean(row.enabled), timeoutMs: Number(row.timeout_ms) || 120_000,
    configVersion: Number(row.config_version) || 1, keyVersion: Number(row.key_version) || 1,
    options: parseObject(row.options_json), lastTestStatus: row.last_test_status,
    lastTestedAt: row.last_tested_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function decodeProfile(row: ProfileRow): ModelProfile {
  return {
    id: row.id, modelKey: row.model_key, displayName: row.display_name,
    mediaType: row.media_type as ModelMediaType, status: row.status as ModelStatus,
    isDefaultFor: parseArray(row.is_default_for_json), sortOrder: Number(row.sort_order) || 100,
    taskKinds: parseArray(row.task_kinds_json), capabilitySchemaVersion: Number(row.capability_schema_version) || 1,
    capabilities: parseObject(row.capabilities_json), defaultParameters: parseObject(row.default_parameters_json),
    lockedParameters: parseObject(row.locked_parameters_json), routePolicy: row.route_policy as ModelRoutePolicy,
    pricingPolicy: parseObject(row.pricing_policy_json), accessPolicy: parseObject(row.access_policy_json),
    limits: parseObject(row.limits_json), configVersion: Number(row.config_version) || 1,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function decodeModel(row: ModelRow): GatewayModel {
  return {
    id: row.id, gatewayId: row.gateway_id, modelProfileId: row.model_profile_id,
    upstreamModelId: row.upstream_model_id, protocol: row.protocol,
    protocolVersion: row.protocol_version, adapterVersion: row.adapter_version,
    priority: Number(row.priority) || 100, status: row.status as ModelStatus,
    capabilitiesOverride: parseObject(row.capabilities_override_json),
    parametersOverride: parseObject(row.parameters_override_json),
    protocolOptions: parseObject(row.protocol_options_json), voiceMap: parseObject(row.voice_map_json),
    pricingOverride: parseObject(row.pricing_override_json), priceVersion: Number(row.price_version) || 1,
    inputTransport: parseObject(row.input_transport_json), outputPolicy: parseObject(row.output_policy_json),
    endpointPathOverride: row.endpoint_path_override, configVersion: Number(row.config_version) || 1,
    lastTestStatus: row.last_test_status, lastTestDetail: row.last_test_detail,
    lastTestedAt: row.last_tested_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function normalizeUrl(value: unknown): string {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('Base URL 不是有效 URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Base URL 仅支持 http:// 或 https://');
  if (parsed.username || parsed.password) throw new Error('Base URL 不能包含用户名或密码');
  return raw;
}

function normalizeStatus(value: unknown): ModelStatus {
  return value === 'disabled' || value === 'revoked' ? value : 'active';
}

function normalizeModelKey(value: unknown): string {
  const key = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._:/-]{1,119}$/i.test(key)) {
    throw new Error('modelKey 需为 2-120 位字母、数字、点、斜杠、冒号、下划线或连字符');
  }
  return key;
}

function normalizeMediaType(value: unknown): ModelMediaType {
  if (value !== 'text' && value !== 'image' && value !== 'video' && value !== 'audio') {
    throw new Error('模型媒体类型无效');
  }
  return value;
}

function allowedTaskKinds(mediaType: ModelMediaType, input: unknown): string[] {
  const allowed = new Set<string>(MODEL_TASK_KINDS[mediaType]);
  const requested = Array.isArray(input) ? input : [];
  const tasks = [...new Set(requested.map(String).filter((item) => allowed.has(item)))];
  return tasks.length ? tasks : [MODEL_TASK_KINDS[mediaType][0]];
}

function normalizeProtocol(mediaType: ModelMediaType, protocol: unknown): string {
  const value = String(protocol || '').trim();
  if (!MODEL_PROTOCOLS[mediaType].some((item) => item.id === value)) throw new Error('接口协议与模型类型不匹配');
  return value;
}

function normalizeEndpointOverride(value: unknown): string | null {
  if (value == null || value === '') return null;
  const path = String(value).trim();
  if (!path.startsWith('/') || path.startsWith('//') || /[?#]/.test(path)) {
    throw new Error('自定义接口路径必须是同源绝对路径，且不能包含查询参数或片段');
  }
  return path;
}

function maskSecret(value: string): string | null {
  return value ? `•••• ${value.slice(-4)}` : null;
}

async function gatewayRows(executor: DbExecutor = getDbDriver()): Promise<GatewayRow[]> {
  return executor.query<GatewayRow>(`SELECT ${gatewayColumns} FROM api_gateways ORDER BY created_at`);
}
async function profileRows(executor: DbExecutor = getDbDriver()): Promise<ProfileRow[]> {
  return executor.query<ProfileRow>(`SELECT ${profileColumns} FROM ai_model_profiles ORDER BY media_type, sort_order, created_at`);
}
async function modelRows(executor: DbExecutor = getDbDriver()): Promise<ModelRow[]> {
  return executor.query<ModelRow>(`SELECT ${modelColumns} FROM api_gateway_models ORDER BY model_profile_id, priority, created_at`);
}

export async function listModelRoutingAdmin(): Promise<{
  gateways: ApiGatewayView[];
  profiles: ModelProfile[];
  models: GatewayModelView[];
}> {
  const [gateways, profiles, models] = await Promise.all([
    gatewayRows().then((rows) => rows.map(decodeGateway)),
    profileRows().then((rows) => rows.map(decodeProfile)),
    modelRows().then((rows) => rows.map(decodeModel)),
  ]);
  const profileById = new Map(profiles.map((item) => [item.id, item]));
  const gatewayById = new Map(gateways.map((item) => [item.id, item]));
  const counts = new Map<string, number>();
  for (const model of models) counts.set(model.gatewayId, (counts.get(model.gatewayId) || 0) + 1);
  return {
    gateways: gateways.map((gateway) => {
      const { apiKey, ...view } = gateway;
      return {
        ...view, apiKeyConfigured: !!apiKey, maskedApiKey: maskSecret(apiKey),
        modelCount: counts.get(gateway.id) || 0,
      };
    }),
    profiles,
    models: models.flatMap((model) => {
      const profile = profileById.get(model.modelProfileId);
      const gateway = gatewayById.get(model.gatewayId);
      return profile && gateway
        ? [{ ...model, gatewayName: gateway.name, modelKey: profile.modelKey, displayName: profile.displayName, mediaType: profile.mediaType }]
        : [];
    }),
  };
}

export async function createGateway(input: GatewayMutation, userId: string): Promise<void> {
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new Error('渠道名称长度应为 1-80 个字符');
  const baseUrl = normalizeUrl(input.baseUrl);
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey || apiKey.length > 8192 || /[\r\n\0]/.test(apiKey)) throw new Error('API Key 格式无效');
  const timeoutMs = Math.trunc(Number(input.timeoutMs ?? 120_000));
  if (timeoutMs < 5_000 || timeoutMs > 900_000) throw new Error('超时必须在 5000-900000 ms 之间');
  const id = nanoid();
  const now = new Date().toISOString();
  await getDbDriver().run(
    `INSERT INTO api_gateways
      (id, name, kind, base_url, api_key_encrypted, auth_mode, enabled, timeout_ms,
       config_version, key_version, options_json, updated_by, created_at, updated_at)
     VALUES (?, ?, 'newapi', ?, ?, 'bearer', ?, ?, 1, 1, ?, ?, ?, ?)`,
    [id, name, baseUrl, encryptRuntimeSecret(gatewaySecretScope(id), apiKey), input.enabled === false ? 0 : 1,
      timeoutMs, JSON.stringify(input.options || {}), userId, now, now],
  );
  await loadModelRoutingIntoEnv();
}

export async function updateGateway(id: string, input: GatewayMutation, userId: string): Promise<void> {
  const row = await getDbDriver().get<GatewayRow>(`SELECT ${gatewayColumns} FROM api_gateways WHERE id = ?`, [id]);
  if (!row) throw new Error('渠道不存在');
  const current = decodeGateway(row);
  if (input.configVersion != null && Number(input.configVersion) !== current.configVersion) {
    throw new Error('渠道配置已被其他管理员更新，请刷新后重试');
  }
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new Error('渠道名称长度应为 1-80 个字符');
  const baseUrl = normalizeUrl(input.baseUrl);
  const originChanged = new URL(baseUrl).origin !== new URL(current.baseUrl).origin;
  if (originChanged && input.apiKey === undefined) throw new Error('更换目标域名时必须重新输入 API Key');
  const apiKey = input.apiKey === undefined ? current.apiKey : String(input.apiKey || '').trim();
  if (!apiKey || apiKey.length > 8192 || /[\r\n\0]/.test(apiKey)) throw new Error('API Key 格式无效');
  const keyChanged = input.apiKey !== undefined && apiKey !== current.apiKey;
  const timeoutMs = Math.trunc(Number(input.timeoutMs ?? current.timeoutMs));
  if (timeoutMs < 5_000 || timeoutMs > 900_000) throw new Error('超时必须在 5000-900000 ms 之间');
  const result = await getDbDriver().run(
    `UPDATE api_gateways
        SET name = ?, base_url = ?, api_key_encrypted = ?, enabled = ?, timeout_ms = ?,
            options_json = ?, updated_by = ?, config_version = config_version + 1,
            key_version = key_version + ?, updated_at = ?
      WHERE id = ? AND config_version = ?`,
    [name, baseUrl, encryptRuntimeSecret(gatewaySecretScope(id), apiKey), input.enabled === false ? 0 : 1,
      timeoutMs, JSON.stringify(input.options || current.options), userId, keyChanged ? 1 : 0,
      new Date().toISOString(), id, current.configVersion],
  );
  if (!result.changes) throw new Error('渠道配置冲突，请刷新后重试');
  await loadModelRoutingIntoEnv();
}

export async function deleteGateway(id: string): Promise<void> {
  const count = await getDbDriver().get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM api_gateway_models WHERE gateway_id = ?', [id],
  );
  if (Number(count?.count || 0) > 0) throw new Error('请先删除该渠道下的模型映射');
  const result = await getDbDriver().run('DELETE FROM api_gateways WHERE id = ?', [id]);
  if (!result.changes) throw new Error('渠道不存在');
  await loadModelRoutingIntoEnv();
}

function normalizeProfile(input: ProfileMutation): Omit<ModelProfile, 'id' | 'configVersion' | 'createdAt' | 'updatedAt'> {
  const mediaType = normalizeMediaType(input.mediaType);
  const modelKey = normalizeModelKey(input.modelKey);
  const displayName = String(input.displayName || '').trim();
  if (!displayName || displayName.length > 120) throw new Error('模型显示名称长度应为 1-120 个字符');
  const taskKinds = allowedTaskKinds(mediaType, input.taskKinds);
  const defaultRequested = Array.isArray(input.isDefaultFor) ? input.isDefaultFor : [];
  const isDefaultFor = allowedTaskKinds(mediaType, defaultRequested).filter(
    (item) => defaultRequested.includes(item) && taskKinds.includes(item),
  );
  const sortOrder = Math.trunc(Number(input.sortOrder ?? 100));
  if (!Number.isFinite(sortOrder) || sortOrder < 1 || sortOrder > 9999) throw new Error('显示顺序必须在 1-9999 之间');
  return {
    modelKey, displayName, mediaType, status: normalizeStatus(input.status), isDefaultFor,
    sortOrder, taskKinds, capabilitySchemaVersion: 1,
    capabilities: normalizeObject(input.capabilities, '能力配置'),
    defaultParameters: normalizeObject(input.defaultParameters, '默认参数'),
    lockedParameters: normalizeObject(input.lockedParameters, '锁定参数'),
    routePolicy: input.routePolicy === 'pinned' ? 'pinned' : 'priority_failover',
    pricingPolicy: normalizeObject(input.pricingPolicy, '价格策略'),
    accessPolicy: normalizeObject(input.accessPolicy, '访问策略'),
    limits: normalizeObject(input.limits, '调用限制'),
  };
}

async function clearDefaultConflicts(executor: DbExecutor, profileId: string, taskKinds: string[]): Promise<void> {
  if (!taskKinds.length) return;
  const rows = await profileRows(executor);
  for (const row of rows) {
    if (row.id === profileId) continue;
    const current = parseArray(row.is_default_for_json);
    const next = current.filter((task) => !taskKinds.includes(task));
    if (next.length !== current.length) {
      await executor.run(
        'UPDATE ai_model_profiles SET is_default_for_json = ?, config_version = config_version + 1, updated_at = ? WHERE id = ?',
        [JSON.stringify(next), new Date().toISOString(), row.id],
      );
    }
  }
}

async function insertProfile(executor: DbExecutor, input: ProfileMutation): Promise<string> {
  const profile = normalizeProfile(input);
  const id = nanoid();
  const now = new Date().toISOString();
  await clearDefaultConflicts(executor, id, profile.isDefaultFor);
  await executor.run(
    `INSERT INTO ai_model_profiles
      (id, model_key, display_name, media_type, status, is_default_for_json, sort_order,
       task_kinds_json, capability_schema_version, capabilities_json, default_parameters_json,
       locked_parameters_json, route_policy, pricing_policy_json, access_policy_json, limits_json,
       config_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, profile.modelKey, profile.displayName, profile.mediaType, profile.status,
      JSON.stringify(profile.isDefaultFor), profile.sortOrder, JSON.stringify(profile.taskKinds),
      JSON.stringify(profile.capabilities), JSON.stringify(profile.defaultParameters),
      JSON.stringify(profile.lockedParameters), profile.routePolicy, JSON.stringify(profile.pricingPolicy),
      JSON.stringify(profile.accessPolicy), JSON.stringify(profile.limits), now, now],
  );
  return id;
}

export async function createGatewayModel(input: GatewayModelMutation): Promise<void> {
  await getDbDriver().transaction(async (tx) => {
    const gateway = await tx.get<{ id: string }>('SELECT id FROM api_gateways WHERE id = ?', [input.gatewayId]);
    if (!gateway) throw new Error('渠道不存在');
    const profileId = input.modelProfileId || (input.profile ? await insertProfile(tx, input.profile) : '');
    if (!profileId) throw new Error('必须绑定逻辑模型或创建新逻辑模型');
    const profileRow = await tx.get<ProfileRow>(`SELECT ${profileColumns} FROM ai_model_profiles WHERE id = ?`, [profileId]);
    if (!profileRow) throw new Error('逻辑模型不存在');
    const profile = decodeProfile(profileRow);
    const upstreamModelId = String(input.upstreamModelId || '').trim();
    if (!upstreamModelId || upstreamModelId.length > 300 || /[\r\n\0]/.test(upstreamModelId)) {
      throw new Error('上游模型 ID 格式无效');
    }
    const protocol = normalizeProtocol(profile.mediaType, input.protocol);
    const priority = Math.trunc(Number(input.priority ?? 100));
    if (!Number.isFinite(priority) || priority < 1 || priority > 9999) throw new Error('优先级必须在 1-9999 之间');
    const status = normalizeStatus(input.status);
    const duplicatePriority = await tx.get<{ id: string }>(
      'SELECT id FROM api_gateway_models WHERE model_profile_id = ? AND priority = ? AND status = ?',
      [profileId, priority, 'active'],
    );
    if (status === 'active' && duplicatePriority) throw new Error('同一逻辑模型的启用映射不能使用重复优先级');
    const existing = await tx.get<{ id: string }>(
      'SELECT id FROM api_gateway_models WHERE gateway_id = ? AND model_profile_id = ?',
      [input.gatewayId, profileId],
    );
    if (existing) throw new Error('该渠道已绑定此逻辑模型');
    if (profile.routePolicy === 'pinned' && status === 'active') {
      const active = await tx.get<{ id: string }>(
        `SELECT id FROM api_gateway_models WHERE model_profile_id = ? AND status = 'active'`, [profileId],
      );
      if (active) throw new Error('pinned 逻辑模型只能启用一条渠道映射');
    }
    const now = new Date().toISOString();
    await tx.run(
      `INSERT INTO api_gateway_models
        (id, gateway_id, model_profile_id, upstream_model_id, protocol, protocol_version,
         adapter_version, priority, status, capabilities_override_json, parameters_override_json,
         protocol_options_json, voice_map_json, pricing_override_json, price_version,
         input_transport_json, output_policy_json, endpoint_path_override, config_version,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '1', '1', ?, ?, ?, ?, ?, ?, ?, 1, '{}', '{}', ?, 1, ?, ?)`,
      [nanoid(), input.gatewayId, profileId, upstreamModelId, protocol, priority, status,
        JSON.stringify(normalizeObject(input.capabilitiesOverride, '映射能力覆盖')),
        JSON.stringify(normalizeObject(input.parametersOverride, '映射参数覆盖')),
        JSON.stringify(normalizeObject(input.protocolOptions, '协议选项')),
        JSON.stringify(normalizeObject(input.voiceMap, '音色映射')),
        JSON.stringify(normalizeObject(input.pricingOverride, '映射价格')),
        normalizeEndpointOverride(input.endpointPathOverride), now, now],
    );
  });
  await loadModelRoutingIntoEnv();
}

export async function updateModelProfile(id: string, input: ProfileMutation): Promise<void> {
  const currentRow = await getDbDriver().get<ProfileRow>(
    `SELECT ${profileColumns} FROM ai_model_profiles WHERE id = ?`, [id],
  );
  if (!currentRow) throw new Error('逻辑模型不存在');
  const current = decodeProfile(currentRow);
  const profile = normalizeProfile({
    ...input,
    status: input.status ?? current.status,
    isDefaultFor: input.isDefaultFor ?? current.isDefaultFor,
    sortOrder: input.sortOrder ?? current.sortOrder,
    taskKinds: input.taskKinds ?? current.taskKinds,
    capabilities: input.capabilities ?? current.capabilities,
    defaultParameters: input.defaultParameters ?? current.defaultParameters,
    lockedParameters: input.lockedParameters ?? current.lockedParameters,
    routePolicy: input.routePolicy ?? current.routePolicy,
    pricingPolicy: input.pricingPolicy ?? current.pricingPolicy,
    accessPolicy: input.accessPolicy ?? current.accessPolicy,
    limits: input.limits ?? current.limits,
  });
  if (current.modelKey !== profile.modelKey) throw new Error('modelKey 创建后不能修改');
  if (current.mediaType !== profile.mediaType) throw new Error('模型媒体类型创建后不能修改');
  if (input.configVersion != null && Number(input.configVersion) !== current.configVersion) {
    throw new Error('模型配置已被其他管理员更新，请刷新后重试');
  }
  if (profile.routePolicy === 'pinned') {
    const active = await getDbDriver().get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM api_gateway_models
        WHERE model_profile_id = ? AND status = 'active'`, [id],
    );
    if (Number(active?.count || 0) > 1) {
      throw new Error('切换为 pinned 前只能保留一条启用的渠道映射');
    }
  }
  await getDbDriver().transaction(async (tx) => {
    await clearDefaultConflicts(tx, id, profile.isDefaultFor);
    const result = await tx.run(
      `UPDATE ai_model_profiles
          SET display_name = ?, media_type = ?, status = ?, is_default_for_json = ?, sort_order = ?,
              task_kinds_json = ?, capabilities_json = ?, default_parameters_json = ?,
              locked_parameters_json = ?, route_policy = ?, pricing_policy_json = ?,
              access_policy_json = ?, limits_json = ?, config_version = config_version + 1,
              updated_at = ?
        WHERE id = ? AND config_version = ?`,
      [profile.displayName, profile.mediaType, profile.status, JSON.stringify(profile.isDefaultFor),
        profile.sortOrder, JSON.stringify(profile.taskKinds), JSON.stringify(profile.capabilities),
        JSON.stringify(profile.defaultParameters), JSON.stringify(profile.lockedParameters),
        profile.routePolicy, JSON.stringify(profile.pricingPolicy), JSON.stringify(profile.accessPolicy),
        JSON.stringify(profile.limits), new Date().toISOString(), id, current.configVersion],
    );
    if (!result.changes) throw new Error('模型配置冲突，请刷新后重试');
  });
  await loadModelRoutingIntoEnv();
}

export async function updateGatewayModel(id: string, input: GatewayModelMutation): Promise<void> {
  const currentRow = await getDbDriver().get<ModelRow>(`SELECT ${modelColumns} FROM api_gateway_models WHERE id = ?`, [id]);
  if (!currentRow) throw new Error('渠道模型映射不存在');
  const current = decodeModel(currentRow);
  if (input.configVersion != null && Number(input.configVersion) !== current.configVersion) {
    throw new Error('渠道模型配置已被其他管理员更新，请刷新后重试');
  }
  if (input.gatewayId !== current.gatewayId || (input.modelProfileId && input.modelProfileId !== current.modelProfileId)) {
    throw new Error('渠道模型映射不能改绑，请删除后重新创建');
  }
  const profileRow = await getDbDriver().get<ProfileRow>(
    `SELECT ${profileColumns} FROM ai_model_profiles WHERE id = ?`, [current.modelProfileId],
  );
  if (!profileRow) throw new Error('逻辑模型不存在');
  const profile = decodeProfile(profileRow);
  const upstreamModelId = String(input.upstreamModelId || '').trim();
  if (!upstreamModelId || upstreamModelId.length > 300 || /[\r\n\0]/.test(upstreamModelId)) {
    throw new Error('上游模型 ID 格式无效');
  }
  const protocol = normalizeProtocol(profile.mediaType, input.protocol);
  const priority = Math.trunc(Number(input.priority ?? current.priority));
  if (!Number.isFinite(priority) || priority < 1 || priority > 9999) throw new Error('优先级必须在 1-9999 之间');
  const status = normalizeStatus(input.status);
  if (status === 'active') {
    const duplicatePriority = await getDbDriver().get<{ id: string }>(
      `SELECT id FROM api_gateway_models
        WHERE model_profile_id = ? AND priority = ? AND status = 'active' AND id <> ?`,
      [current.modelProfileId, priority, id],
    );
    if (duplicatePriority) throw new Error('同一逻辑模型的启用映射不能使用重复优先级');
    if (profile.routePolicy === 'pinned') {
      const active = await getDbDriver().get<{ id: string }>(
        `SELECT id FROM api_gateway_models
          WHERE model_profile_id = ? AND status = 'active' AND id <> ?`,
        [current.modelProfileId, id],
      );
      if (active) throw new Error('pinned 逻辑模型只能启用一条渠道映射');
    }
  }
  const result = await getDbDriver().run(
    `UPDATE api_gateway_models
        SET upstream_model_id = ?, protocol = ?, priority = ?, status = ?,
            capabilities_override_json = ?, parameters_override_json = ?, protocol_options_json = ?,
            voice_map_json = ?, pricing_override_json = ?, endpoint_path_override = ?,
            config_version = config_version + 1, updated_at = ?
      WHERE id = ? AND config_version = ?`,
    [upstreamModelId, protocol, priority, status,
      JSON.stringify(normalizeObject(input.capabilitiesOverride ?? current.capabilitiesOverride, '映射能力覆盖')),
      JSON.stringify(normalizeObject(input.parametersOverride ?? current.parametersOverride, '映射参数覆盖')),
      JSON.stringify(normalizeObject(input.protocolOptions ?? current.protocolOptions, '协议选项')),
      JSON.stringify(normalizeObject(input.voiceMap ?? current.voiceMap, '音色映射')),
      JSON.stringify(normalizeObject(input.pricingOverride ?? current.pricingOverride, '映射价格')),
      normalizeEndpointOverride(input.endpointPathOverride ?? current.endpointPathOverride),
      new Date().toISOString(), id, current.configVersion],
  );
  if (!result.changes) throw new Error('渠道模型配置冲突，请刷新后重试');
  await loadModelRoutingIntoEnv();
}

export async function deleteGatewayModel(id: string): Promise<void> {
  const result = await getDbDriver().run('DELETE FROM api_gateway_models WHERE id = ?', [id]);
  if (!result.changes) throw new Error('渠道模型映射不存在');
  await loadModelRoutingIntoEnv();
}

export async function deleteModelProfile(id: string): Promise<void> {
  const routes = await getDbDriver().get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM api_gateway_models WHERE model_profile_id = ?', [id],
  );
  if (Number(routes?.count || 0) > 0) throw new Error('请先删除该逻辑模型的渠道映射');
  const result = await getDbDriver().run('DELETE FROM ai_model_profiles WHERE id = ?', [id]);
  if (!result.changes) throw new Error('逻辑模型不存在');
  await loadModelRoutingIntoEnv();
}

export async function getGatewaySecret(id: string): Promise<ApiGateway | null> {
  const row = await getDbDriver().get<GatewayRow>(`SELECT ${gatewayColumns} FROM api_gateways WHERE id = ?`, [id]);
  return row ? decodeGateway(row) : null;
}

export async function getGatewayModel(id: string): Promise<RuntimeModelRoute | null> {
  const [gateways, profiles, models] = await Promise.all([
    gatewayRows().then((rows) => rows.map(decodeGateway)),
    profileRows().then((rows) => rows.map(decodeProfile)),
    modelRows().then((rows) => rows.map(decodeModel)),
  ]);
  const model = models.find((item) => item.id === id);
  if (!model) return null;
  const gateway = gateways.find((item) => item.id === model.gatewayId);
  const profile = profiles.find((item) => item.id === model.modelProfileId);
  return gateway && profile ? { ...model, gateway, profile } : null;
}

export async function markGatewayTestResult(id: string, ok: boolean): Promise<void> {
  const now = new Date().toISOString();
  await getDbDriver().run(
    'UPDATE api_gateways SET last_test_status = ?, last_tested_at = ?, updated_at = ? WHERE id = ?',
    [ok ? 'ok' : 'failed', now, now, id],
  );
  await loadModelRoutingIntoEnv();
}

export async function markGatewayModelTestResult(id: string, ok: boolean, detail: string): Promise<void> {
  const now = new Date().toISOString();
  await getDbDriver().run(
    `UPDATE api_gateway_models
        SET last_test_status = ?, last_test_detail = ?, last_tested_at = ?, updated_at = ?
      WHERE id = ?`,
    [ok ? 'ok' : 'failed', detail.slice(0, 500), now, now, id],
  );
  await loadModelRoutingIntoEnv();
}

export async function loadModelRoutingIntoEnv(): Promise<number> {
  try {
    const [gateways, profiles, models] = await Promise.all([
      gatewayRows().then((rows) => rows.map(decodeGateway)),
      profileRows().then((rows) => rows.map(decodeProfile)),
      modelRows().then((rows) => rows.map(decodeModel)),
    ]);
    const gatewayById = new Map(gateways.filter((item) => item.enabled).map((item) => [item.id, item]));
    const profileById = new Map(profiles.filter((item) => item.status === 'active').map((item) => [item.id, item]));
    const routes = models
      .filter((item) => item.status === 'active')
      .flatMap((item) => {
        const gateway = gatewayById.get(item.gatewayId);
        const profile = profileById.get(item.modelProfileId);
        return gateway && profile ? [{ ...item, gateway, profile }] : [];
      })
      .sort((a, b) => a.profile.modelKey.localeCompare(b.profile.modelKey)
        || a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
    process.env[RUNTIME_MODEL_ROUTES_ENV] = JSON.stringify(routes);
    return routes.length;
  } catch {
    process.env[RUNTIME_MODEL_ROUTES_ENV] = '[]';
    return 0;
  }
}

export function listRuntimeModelRoutesSync(mediaType?: ModelMediaType): RuntimeModelRoute[] {
  let routes: RuntimeModelRoute[] = [];
  try { routes = JSON.parse(process.env[RUNTIME_MODEL_ROUTES_ENV] || '[]') as RuntimeModelRoute[]; } catch {}
  return routes
    .filter((route) => !mediaType || route.profile.mediaType === mediaType)
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}

export function resolveModelRoutesSync(
  modelKey: string,
  mediaType?: ModelMediaType,
  taskKind?: string,
): RuntimeModelRoute[] {
  const routes = listRuntimeModelRoutesSync(mediaType).filter((route) => {
    if (route.profile.modelKey !== modelKey) return false;
    return !taskKind || route.profile.taskKinds.includes(taskKind);
  });
  return routes[0]?.profile.routePolicy === 'pinned' ? routes.slice(0, 1) : routes;
}

export async function listModelCatalog(taskKind?: string, mediaType?: ModelMediaType): Promise<ModelCatalogItem[]> {
  const [gateways, profiles, models] = await Promise.all([
    gatewayRows().then((rows) => rows.map(decodeGateway)),
    profileRows().then((rows) => rows.map(decodeProfile)),
    modelRows().then((rows) => rows.map(decodeModel)),
  ]);
  const enabledGateways = new Set(gateways.filter((item) => item.enabled).map((item) => item.id));
  return profiles
    .filter((profile) => profile.status === 'active')
    .filter((profile) => !mediaType || profile.mediaType === mediaType)
    .filter((profile) => !taskKind || profile.taskKinds.includes(taskKind))
    .map((profile) => ({
      profile,
      routeCount: models.filter((route) =>
        route.modelProfileId === profile.id && route.status === 'active' && enabledGateways.has(route.gatewayId)).length,
    }))
    .filter((item) => item.routeCount > 0)
    .map(({ profile, routeCount }) => ({
      modelKey: profile.modelKey, displayName: profile.displayName, mediaType: profile.mediaType,
      taskKinds: profile.taskKinds, isDefaultFor: profile.isDefaultFor, capabilities: profile.capabilities,
      defaultParameters: profile.defaultParameters, lockedParameters: profile.lockedParameters,
      routePolicy: profile.routePolicy, routeCount,
    }));
}

export async function validateModelSelections(selections: unknown): Promise<ModelSelections> {
  if (selections == null) return {};
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
    throw new Error('modelSelections 格式无效');
  }
  const catalog = await listModelCatalog();
  const byKey = new Map(catalog.map((item) => [item.modelKey, item]));
  const normalized: ModelSelections = {};
  for (const [taskKind, rawKey] of Object.entries(selections as Record<string, unknown>)) {
    const mediaType = taskKind.split('.')[0] as ModelMediaType;
    const allowed = MODEL_TASK_KINDS[mediaType] as readonly string[] | undefined;
    if (!allowed?.includes(taskKind)) throw new Error(`不支持的任务角色: ${taskKind}`);
    const modelKey = String(rawKey || '').trim();
    const model = byKey.get(modelKey);
    if (!model) throw new Error(`模型不可用: ${modelKey}`);
    if (model.mediaType !== mediaType || !model.taskKinds.includes(taskKind)) {
      throw new Error(`模型 ${model.displayName} 不能用于 ${taskKind}`);
    }
    normalized[taskKind] = modelKey;
  }
  return normalized;
}

export function modelKeyForTask(selections: ModelSelections | undefined, taskKind: string): string | undefined {
  if (!selections) return undefined;
  const mediaType = taskKind.split('.')[0];
  return selections[taskKind] || selections[`${mediaType}.default`];
}

export function mergeRouteParameters(
  route: RuntimeModelRoute,
  requestParameters: Record<string, unknown>,
  serverConstraints: Record<string, unknown> = {},
): Record<string, unknown> {
  const allowed = new Set(Object.keys(route.profile.defaultParameters));
  const requested = Object.fromEntries(
    Object.entries(requestParameters).filter(([key]) => allowed.has(key) && !(key in route.profile.lockedParameters)),
  );
  return {
    ...route.profile.defaultParameters, ...requested, ...route.parametersOverride,
    ...route.profile.lockedParameters, ...serverConstraints,
  };
}

export function classifyModelRouteError(error: unknown): {
  category: string; safeToFailover: boolean; message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/REMOTE_TASK_CREATED/i.test(message)) {
    return { category: 'uncertain_submit', safeToFailover: false, message };
  }
  if (/abort|timeout|timed out|econnreset|socket hang|fetch failed/i.test(message)) {
    return { category: 'uncertain_submit', safeToFailover: false, message };
  }
  if (/\b401\b|\b403\b|unauthor|forbidden|api.?key/i.test(message)) {
    return { category: 'auth', safeToFailover: true, message };
  }
  if (/\b402\b|quota|余额|insufficient/i.test(message)) {
    return { category: 'quota', safeToFailover: true, message };
  }
  if (/\b429\b|rate.?limit|限流/i.test(message)) {
    return { category: 'rate_limit', safeToFailover: true, message };
  }
  if (/\b404\b|model.?not.?found|unknown model|模型不存在/i.test(message)) {
    return { category: 'model_unavailable', safeToFailover: true, message };
  }
  if (/\b400\b|invalid|参数|审核|policy|sensitive|content/i.test(message)) {
    return { category: 'upstream_rejected', safeToFailover: false, message };
  }
  return { category: 'transient', safeToFailover: false, message };
}

export interface ModelCallContext {
  operation: string;
  taskKind: string;
  projectId?: string;
  pipelineJobId?: string;
  userId?: string;
  idempotencyKey?: string;
  requestParameters?: Record<string, unknown>;
}

function routeSnapshot(route: RuntimeModelRoute) {
  return {
    gatewayModelId: route.id,
    gatewayId: route.gatewayId,
    gatewayName: route.gateway.name,
    gatewayConfigVersion: route.gateway.configVersion,
    modelProfileId: route.modelProfileId,
    modelKey: route.profile.modelKey,
    modelConfigVersion: route.profile.configVersion,
    upstreamModelId: route.upstreamModelId,
    protocol: route.protocol,
    priority: route.priority,
    routeConfigVersion: route.configVersion,
  };
}

async function beginModelCall(routes: RuntimeModelRoute[], context: ModelCallContext): Promise<string | null> {
  const first = routes[0];
  if (!first) return null;
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    await getDbDriver().run(
      `INSERT INTO ai_model_calls
        (id, idempotency_key, project_id, pipeline_job_id, user_id, operation, task_kind,
         media_type, state, routing_version, requested_model_key, requested_model_snapshot_json,
         ordered_routes_snapshot_json, request_parameters_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', 2, ?, ?, ?, ?, ?, ?)`,
      [id, context.idempotencyKey || `model-call:${nanoid()}`, context.projectId || null,
        context.pipelineJobId || null, context.userId || null, context.operation, context.taskKind,
        first.profile.mediaType, first.profile.modelKey,
        JSON.stringify({
          modelKey: first.profile.modelKey,
          displayName: first.profile.displayName,
          mediaType: first.profile.mediaType,
          taskKinds: first.profile.taskKinds,
          capabilities: first.profile.capabilities,
          defaultParameters: first.profile.defaultParameters,
          lockedParameters: first.profile.lockedParameters,
          routePolicy: first.profile.routePolicy,
          configVersion: first.profile.configVersion,
        }),
        JSON.stringify(routes.map(routeSnapshot)), JSON.stringify(context.requestParameters || {}), now, now],
    );
    return id;
  } catch (error) {
    console.warn('[ModelRouting] 调用日志创建失败:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function beginModelAttempt(callId: string | null, route: RuntimeModelRoute, sequence: number): Promise<string | null> {
  if (!callId) return null;
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    await getDbDriver().run(
      `INSERT INTO ai_model_call_attempts
        (id, model_call_id, sequence, gateway_model_id, gateway_id, gateway_model_snapshot_json,
         attempt_idempotency_key, state, upstream_model_id, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
      [id, callId, sequence, route.id, route.gatewayId, JSON.stringify(routeSnapshot(route)),
        `${callId}:${sequence}`, route.upstreamModelId, now, now, now],
    );
    await getDbDriver().run(
      'UPDATE ai_model_calls SET attempt_count = ?, submitted_at = COALESCE(submitted_at, ?), updated_at = ? WHERE id = ?',
      [sequence, now, now, callId],
    );
    return id;
  } catch (error) {
    console.warn('[ModelRouting] 尝试日志创建失败:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function finishModelAttempt(
  callId: string | null,
  attemptId: string | null,
  route: RuntimeModelRoute,
  result: unknown,
): Promise<void> {
  if (!callId) return;
  const now = new Date().toISOString();
  const resultObject = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const upstreamTaskId = typeof resultObject.upstreamId === 'string' ? resultObject.upstreamId : null;
  try {
    if (attemptId) {
      await getDbDriver().run(
        `UPDATE ai_model_call_attempts SET state = 'completed', returned_model_id = ?,
          upstream_task_id = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        [route.upstreamModelId, upstreamTaskId, now, now, attemptId],
      );
    }
    await getDbDriver().run(
      `UPDATE ai_model_calls SET state = 'completed', successful_attempt_id = ?, returned_model_id = ?,
        completed_at = ?, updated_at = ? WHERE id = ?`,
      [attemptId, route.upstreamModelId, now, now, callId],
    );
  } catch (error) {
    console.warn('[ModelRouting] 调用成功日志更新失败:', error instanceof Error ? error.message : error);
  }
}

async function failModelAttempt(
  callId: string | null,
  attemptId: string | null,
  classified: ReturnType<typeof classifyModelRouteError>,
  canContinue: boolean,
): Promise<void> {
  if (!callId) return;
  const now = new Date().toISOString();
  const state = classified.category === 'uncertain_submit' ? 'uncertain' : 'failed';
  try {
    if (attemptId) {
      await getDbDriver().run(
        `UPDATE ai_model_call_attempts SET state = ?, error_category = ?, error_summary = ?,
          completed_at = ?, updated_at = ? WHERE id = ?`,
        [state, classified.category, classified.message.slice(0, 500), now, now, attemptId],
      );
    }
    await getDbDriver().run(
      `UPDATE ai_model_calls SET state = ?, error_category = ?, error_summary = ?,
        completed_at = ?, updated_at = ? WHERE id = ?`,
      [canContinue ? 'retrying' : state, classified.category, classified.message.slice(0, 500),
        canContinue ? null : now, now, callId],
    );
  } catch (error) {
    console.warn('[ModelRouting] 调用失败日志更新失败:', error instanceof Error ? error.message : error);
  }
}

export async function runModelRouteChain<T>(
  routes: RuntimeModelRoute[],
  execute: (route: RuntimeModelRoute, sequence: number) => Promise<T>,
  context?: ModelCallContext,
): Promise<T> {
  if (!routes.length) throw new Error('MODEL_ROUTES_EXHAUSTED: 没有可用的模型渠道映射');
  const callId = context ? await beginModelCall(routes, context) : null;
  const errors: string[] = [];
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index];
    const attemptId = await beginModelAttempt(callId, route, index + 1);
    try {
      const result = await execute(route, index + 1);
      await finishModelAttempt(callId, attemptId, route, result);
      return result;
    } catch (error) {
      const classified = classifyModelRouteError(error);
      errors.push(`${route.gateway.name}: ${classified.message}`);
      const canContinue = classified.safeToFailover
        && route.profile.routePolicy !== 'pinned'
        && index + 1 < routes.length;
      await failModelAttempt(callId, attemptId, classified, canContinue);
      if (!canContinue) {
        throw new Error(`${classified.category}: ${classified.message}`);
      }
    }
  }
  throw new Error(`MODEL_ROUTES_EXHAUSTED: ${errors.join(' | ')}`);
}
