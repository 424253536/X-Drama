'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  Eye,
  EyeSlash,
  FilmStrip,
  ImageSquare,
  Key,
  PencilSimple,
  Plus,
  Power,
  Pulse,
  SpeakerHigh,
  Trash,
  WarningCircle,
  X,
  ChatCircle,
} from '@phosphor-icons/react';
import { getToken } from '@/lib/auth';
import type {
  ApiGatewayView,
  GatewayModelView,
  ModelMediaType,
  ModelProfile,
} from '@/lib/model-routing';

type Status = 'active' | 'disabled' | 'revoked';
type RoutePolicy = 'priority_failover' | 'pinned';

interface RoutingState {
  gateways: ApiGatewayView[];
  profiles: ModelProfile[];
  models: GatewayModelView[];
  protocols: Record<ModelMediaType, Array<{ id: string; label: string }>>;
  taskKinds: Record<ModelMediaType, string[]>;
}

interface GatewayForm {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  timeoutMs: number;
  configVersion?: number;
}

interface ModelForm {
  id?: string;
  gatewayId: string;
  modelProfileId: string;
  createProfile: boolean;
  mediaType: ModelMediaType;
  modelKey: string;
  displayName: string;
  upstreamModelId: string;
  protocol: string;
  priority: number;
  status: Status;
  endpointPathOverride: string;
  capabilitiesOverride: string;
  parametersOverride: string;
  protocolOptions: string;
  voiceMap: string;
  pricingOverride: string;
  configVersion?: number;
}

interface ProfileForm {
  id: string;
  modelKey: string;
  displayName: string;
  mediaType: ModelMediaType;
  status: Status;
  taskKinds: string[];
  isDefaultFor: string[];
  sortOrder: number;
  routePolicy: RoutePolicy;
  capabilities: string;
  defaultParameters: string;
  lockedParameters: string;
  pricingPolicy: string;
  accessPolicy: string;
  limits: string;
  configVersion: number;
}

interface SyncResult {
  modelIds: string[];
  discovered: string[];
  configuredMissing: string[];
}

const MEDIA_TYPES: Array<{ id: ModelMediaType; label: string; icon: typeof ChatCircle }> = [
  { id: 'text', label: '文本', icon: ChatCircle },
  { id: 'image', label: '图像', icon: ImageSquare },
  { id: 'video', label: '视频', icon: FilmStrip },
  { id: 'audio', label: '声音', icon: SpeakerHigh },
];

const EMPTY_STATE: RoutingState = {
  gateways: [], profiles: [], models: [],
  protocols: { text: [], image: [], video: [], audio: [] },
  taskKinds: { text: [], image: [], video: [], audio: [] },
};

const DEFAULT_TASK_KIND: Record<ModelMediaType, string> = {
  text: 'text.default', image: 'image.default', video: 'video.default', audio: 'audio.tts',
};

function requestHeaders(json = false): HeadersInit {
  const token = getToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label}必须是 JSON 对象`);
  }
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value || {}, null, 2);
}

function StatusDot({ enabled }: { enabled: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />;
}

function IconButton({ title, onClick, disabled, children, tone = 'normal' }: {
  title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; tone?: 'normal' | 'danger' | 'active';
}) {
  const color = tone === 'danger' ? 'hover:text-rose-300' : tone === 'active' ? 'text-emerald-300' : 'hover:text-[var(--text)]';
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--muted)] hover:bg-white/5 disabled:opacity-35 ${color}`}>
      {children}
    </button>
  );
}

function JsonField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] text-[var(--muted)]">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false}
        className="min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-black/20 px-3 py-2 font-mono text-[11px] leading-5 outline-none focus:border-[var(--primary)]" />
    </label>
  );
}

export function ApiChannelManager() {
  const [data, setData] = useState<RoutingState>(EMPTY_STATE);
  const [selectedGatewayId, setSelectedGatewayId] = useState('');
  const [activeMedia, setActiveMedia] = useState<ModelMediaType>('text');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [gatewayForm, setGatewayForm] = useState<GatewayForm | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [tests, setTests] = useState<Record<string, { ok?: boolean; text: string }>>({});

  const applyState = useCallback((body: Partial<RoutingState>) => {
    setData((current) => ({
      gateways: body.gateways || current.gateways,
      profiles: body.profiles || current.profiles,
      models: body.models || current.models,
      protocols: body.protocols || current.protocols,
      taskKinds: body.taskKinds || current.taskKinds,
    }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/model-routing', { headers: requestHeaders(), cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '读取模型路由失败');
      applyState(body);
      setSelectedGatewayId((current) => current && body.gateways.some((item: ApiGatewayView) => item.id === current)
        ? current : body.gateways[0]?.id || '');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '读取模型路由失败' });
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  useEffect(() => { void load(); }, [load]);

  const selectedGateway = data.gateways.find((item) => item.id === selectedGatewayId);
  const gatewayModels = useMemo(() => data.models
    .filter((item) => item.gatewayId === selectedGatewayId && item.mediaType === activeMedia)
    .sort((a, b) => a.priority - b.priority), [activeMedia, data.models, selectedGatewayId]);
  const activeProfiles = useMemo(() => data.profiles
    .filter((item) => item.mediaType === activeMedia && item.status !== 'revoked')
    .sort((a, b) => a.sortOrder - b.sortOrder), [activeMedia, data.profiles]);

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', payload: unknown, success: string) {
    setBusy('save');
    setMessage(null);
    try {
      const response = await fetch('/api/settings/model-routing', {
        method, headers: requestHeaders(true), body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '操作失败');
      applyState(body);
      setMessage({ type: 'success', text: success });
      return true;
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '操作失败' });
      return false;
    } finally {
      setBusy('');
    }
  }

  function openNewGateway() {
    setGatewayForm({ name: '', baseUrl: '', apiKey: '', enabled: true, timeoutMs: 120000 });
    setShowApiKey(false);
  }

  function openEditGateway(gateway: ApiGatewayView) {
    setGatewayForm({
      id: gateway.id, name: gateway.name, baseUrl: gateway.baseUrl, apiKey: '', enabled: gateway.enabled,
      timeoutMs: gateway.timeoutMs, configVersion: gateway.configVersion,
    });
    setShowApiKey(false);
  }

  async function saveGateway() {
    if (!gatewayForm) return;
    const gateway = {
      name: gatewayForm.name,
      baseUrl: gatewayForm.baseUrl,
      ...(gatewayForm.apiKey ? { apiKey: gatewayForm.apiKey } : {}),
      enabled: gatewayForm.enabled,
      timeoutMs: gatewayForm.timeoutMs,
      configVersion: gatewayForm.configVersion,
    };
    const ok = await mutate(gatewayForm.id ? 'PATCH' : 'POST', gatewayForm.id
      ? { resource: 'gateway', id: gatewayForm.id, gateway }
      : { resource: 'gateway', gateway }, 'NewAPI 渠道已保存，运行时路由已更新。');
    if (ok) {
      setGatewayForm(null);
      if (!gatewayForm.id) await load();
    }
  }

  async function toggleGateway(gateway: ApiGatewayView) {
    await mutate('PATCH', {
      resource: 'gateway', id: gateway.id,
      gateway: {
        name: gateway.name, baseUrl: gateway.baseUrl, enabled: !gateway.enabled,
        timeoutMs: gateway.timeoutMs, configVersion: gateway.configVersion,
      },
    }, gateway.enabled ? '渠道已停用。' : '渠道已启用。');
  }

  async function removeGateway(gateway: ApiGatewayView) {
    if (!window.confirm(`删除 NewAPI 渠道“${gateway.name}”？`)) return;
    const ok = await mutate('DELETE', { resource: 'gateway', id: gateway.id }, '渠道已删除。');
    if (ok && selectedGatewayId === gateway.id) setSelectedGatewayId('');
  }

  function openNewModel(upstreamModelId = '') {
    if (!selectedGatewayId) return;
    const firstProfile = activeProfiles[0];
    setModelForm({
      gatewayId: selectedGatewayId,
      modelProfileId: firstProfile?.id || '',
      createProfile: !firstProfile,
      mediaType: activeMedia,
      modelKey: '', displayName: '', upstreamModelId,
      protocol: data.protocols[activeMedia]?.[0]?.id || '', priority: 100,
      status: 'active', endpointPathOverride: '',
      capabilitiesOverride: '{}', parametersOverride: '{}', protocolOptions: '{}',
      voiceMap: '{}', pricingOverride: '{}',
    });
  }

  function openEditModel(model: GatewayModelView) {
    setModelForm({
      id: model.id, gatewayId: model.gatewayId, modelProfileId: model.modelProfileId,
      createProfile: false, mediaType: model.mediaType, modelKey: model.modelKey,
      displayName: model.displayName, upstreamModelId: model.upstreamModelId,
      protocol: model.protocol, priority: model.priority, status: model.status,
      endpointPathOverride: model.endpointPathOverride || '', configVersion: model.configVersion,
      capabilitiesOverride: formatJson(model.capabilitiesOverride),
      parametersOverride: formatJson(model.parametersOverride),
      protocolOptions: formatJson(model.protocolOptions),
      voiceMap: formatJson(model.voiceMap),
      pricingOverride: formatJson(model.pricingOverride),
    });
  }

  async function saveModel() {
    if (!modelForm) return;
    try {
      const gatewayModel = {
        gatewayId: modelForm.gatewayId,
        modelProfileId: modelForm.createProfile ? undefined : modelForm.modelProfileId,
        ...(modelForm.createProfile ? {
          profile: {
            modelKey: modelForm.modelKey, displayName: modelForm.displayName,
            mediaType: modelForm.mediaType, taskKinds: [DEFAULT_TASK_KIND[modelForm.mediaType]],
          },
        } : {}),
        upstreamModelId: modelForm.upstreamModelId,
        protocol: modelForm.protocol,
        priority: modelForm.priority,
        status: modelForm.status,
        endpointPathOverride: modelForm.endpointPathOverride || null,
        capabilitiesOverride: parseJsonObject(modelForm.capabilitiesOverride, '映射能力覆盖'),
        parametersOverride: parseJsonObject(modelForm.parametersOverride, '映射参数覆盖'),
        protocolOptions: parseJsonObject(modelForm.protocolOptions, '协议选项'),
        voiceMap: parseJsonObject(modelForm.voiceMap, '音色映射'),
        pricingOverride: parseJsonObject(modelForm.pricingOverride, '映射价格'),
        configVersion: modelForm.configVersion,
      };
      const ok = await mutate(modelForm.id ? 'PATCH' : 'POST', modelForm.id
        ? { resource: 'gatewayModel', id: modelForm.id, gatewayModel }
        : { resource: 'gatewayModel', gatewayModel }, '渠道模型映射已保存。');
      if (ok) setModelForm(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '映射配置格式无效' });
    }
  }

  async function toggleModel(model: GatewayModelView) {
    await mutate('PATCH', {
      resource: 'gatewayModel', id: model.id,
      gatewayModel: {
        gatewayId: model.gatewayId, modelProfileId: model.modelProfileId,
        upstreamModelId: model.upstreamModelId, protocol: model.protocol, priority: model.priority,
        status: model.status === 'active' ? 'disabled' : 'active',
        endpointPathOverride: model.endpointPathOverride, configVersion: model.configVersion,
      },
    }, model.status === 'active' ? '模型映射已停用。' : '模型映射已启用。');
  }

  async function removeModel(model: GatewayModelView) {
    if (!window.confirm(`删除“${model.displayName}”在 ${model.gatewayName} 的映射？`)) return;
    await mutate('DELETE', { resource: 'gatewayModel', id: model.id }, '模型映射已删除。');
  }

  function openEditProfile(profile: ModelProfile) {
    setProfileForm({
      id: profile.id, modelKey: profile.modelKey, displayName: profile.displayName,
      mediaType: profile.mediaType, status: profile.status, taskKinds: profile.taskKinds,
      isDefaultFor: profile.isDefaultFor, sortOrder: profile.sortOrder, routePolicy: profile.routePolicy,
      capabilities: formatJson(profile.capabilities), defaultParameters: formatJson(profile.defaultParameters),
      lockedParameters: formatJson(profile.lockedParameters),
      pricingPolicy: formatJson(profile.pricingPolicy),
      accessPolicy: formatJson(profile.accessPolicy),
      limits: formatJson(profile.limits),
      configVersion: profile.configVersion,
    });
  }

  async function saveProfile() {
    if (!profileForm) return;
    try {
      const profile = {
        modelKey: profileForm.modelKey, displayName: profileForm.displayName,
        mediaType: profileForm.mediaType, status: profileForm.status,
        taskKinds: profileForm.taskKinds, isDefaultFor: profileForm.isDefaultFor,
        sortOrder: profileForm.sortOrder, routePolicy: profileForm.routePolicy,
        capabilities: parseJsonObject(profileForm.capabilities, '能力配置'),
        defaultParameters: parseJsonObject(profileForm.defaultParameters, '默认参数'),
        lockedParameters: parseJsonObject(profileForm.lockedParameters, '锁定参数'),
        pricingPolicy: parseJsonObject(profileForm.pricingPolicy, '价格策略'),
        accessPolicy: parseJsonObject(profileForm.accessPolicy, '访问策略'),
        limits: parseJsonObject(profileForm.limits, '调用限制'),
        configVersion: profileForm.configVersion,
      };
      const ok = await mutate('PATCH', { resource: 'profile', id: profileForm.id, profile }, '逻辑模型已更新。');
      if (ok) setProfileForm(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '配置格式无效' });
    }
  }

  async function removeProfile(profile: ModelProfile) {
    if (!window.confirm(`删除逻辑模型“${profile.displayName}”？必须先删除它的全部渠道映射。`)) return;
    await mutate('DELETE', { resource: 'profile', id: profile.id }, '逻辑模型已删除。');
  }

  async function testTarget(target: { gatewayId?: string; gatewayModelId?: string }, key: string) {
    setTests((current) => ({ ...current, [key]: { text: '测试中...' } }));
    try {
      const response = await fetch('/api/settings/model-routing/test', {
        method: 'POST', headers: requestHeaders(true), body: JSON.stringify(target),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.detail || body.message || '测试失败');
      setTests((current) => ({ ...current, [key]: { ok: true, text: body.detail || '连接正常' } }));
      await load();
    } catch (error) {
      setTests((current) => ({
        ...current, [key]: { ok: false, text: error instanceof Error ? error.message : '测试失败' },
      }));
    }
  }

  async function syncGateway() {
    if (!selectedGatewayId) return;
    setBusy('sync');
    setSyncResult(null);
    try {
      const response = await fetch('/api/settings/model-routing/sync', {
        method: 'POST', headers: requestHeaders(true), body: JSON.stringify({ gatewayId: selectedGatewayId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '同步失败');
      setSyncResult(body);
      setMessage({ type: 'success', text: `已读取 ${body.modelIds.length} 个模型 ID；同步结果不会自动启用模型。` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '同步失败' });
    } finally {
      setBusy('');
    }
  }

  function switchTask(task: string, checked: boolean) {
    if (!profileForm) return;
    const taskKinds = checked
      ? [...new Set([...profileForm.taskKinds, task])]
      : profileForm.taskKinds.filter((item) => item !== task);
    const isDefaultFor = profileForm.isDefaultFor.filter((item) => taskKinds.includes(item));
    setProfileForm({ ...profileForm, taskKinds, isDefaultFor });
  }

  return (
    <section className="border-y border-[var(--border)] bg-[rgba(18,18,20,0.55)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.16em] text-[var(--primary)]">MODEL ROUTING V2</div>
          <h2 className="mt-1 text-lg font-semibold">NewAPI 网关与模型目录</h2>
        </div>
        <button type="button" onClick={openNewGateway}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-[#17130a]">
          <Plus size={14} weight="bold" />新增 NewAPI 渠道
        </button>
      </div>

      {message && (
        <div className={`m-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs ${message.type === 'success'
          ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200'
          : 'border-rose-500/25 bg-rose-500/8 text-rose-200'}`}>
          {message.type === 'success' ? <CheckCircle size={15} /> : <WarningCircle size={15} />}
          <span>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="grid h-44 place-items-center text-[var(--muted)]"><CircleNotch size={20} className="animate-spin" /></div>
      ) : (
        <div className="grid min-h-[430px] lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--border)] lg:border-b-0 lg:border-r">
            <div className="border-b border-[var(--border)] px-4 py-3 text-[10px] font-semibold tracking-wider text-[var(--soft)]">
              NEWAPI 渠道 · {data.gateways.length}
            </div>
            {data.gateways.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-[var(--soft)]">先添加一个 NewAPI 网关</div>
            ) : data.gateways.map((gateway) => {
              const selected = gateway.id === selectedGatewayId;
              return (
                <button key={gateway.id} type="button" onClick={() => { setSelectedGatewayId(gateway.id); setSyncResult(null); }}
                  className={`block w-full border-b border-[var(--border)] px-4 py-3 text-left transition-colors ${selected ? 'bg-[var(--primary-muted)]' : 'hover:bg-white/[0.025]'}`}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-xs font-semibold">{gateway.name}</span>
                    <StatusDot enabled={gateway.enabled} />
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">{gateway.baseUrl}</span>
                  <span className="mt-1.5 flex items-center gap-2 text-[9px] text-[var(--soft)]">
                    <span>{gateway.modelCount} 个映射</span><span>·</span>
                    <span>{gateway.maskedApiKey || '未配置密钥'}</span>
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="min-w-0">
            {!selectedGateway ? (
              <div className="grid h-64 place-items-center text-xs text-[var(--soft)]">请选择或新增渠道</div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold"><StatusDot enabled={selectedGateway.enabled} />{selectedGateway.name}</div>
                    <div className="mt-1 truncate text-[10px] text-[var(--soft)]">{selectedGateway.baseUrl}</div>
                    {tests[`g:${selectedGateway.id}`] && (
                      <div className={`mt-1 text-[10px] ${tests[`g:${selectedGateway.id}`].ok === true ? 'text-emerald-300' : tests[`g:${selectedGateway.id}`].ok === false ? 'text-rose-300' : 'text-[var(--soft)]'}`}>
                        {tests[`g:${selectedGateway.id}`].text}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton title="测试渠道连接" onClick={() => void testTarget({ gatewayId: selectedGateway.id }, `g:${selectedGateway.id}`)}><Pulse size={15} /></IconButton>
                    <IconButton title="从 /v1/models 同步" disabled={busy === 'sync'} onClick={() => void syncGateway()}>{busy === 'sync' ? <CircleNotch size={15} className="animate-spin" /> : <ArrowsClockwise size={15} />}</IconButton>
                    <IconButton title={selectedGateway.enabled ? '停用渠道' : '启用渠道'} tone={selectedGateway.enabled ? 'active' : 'normal'} onClick={() => void toggleGateway(selectedGateway)}><Power size={15} /></IconButton>
                    <IconButton title="编辑渠道" onClick={() => openEditGateway(selectedGateway)}><PencilSimple size={15} /></IconButton>
                    <IconButton title="删除渠道" tone="danger" onClick={() => void removeGateway(selectedGateway)}><Trash size={15} /></IconButton>
                  </div>
                </div>

                <div className="grid grid-cols-4 border-b border-[var(--border)]">
                  {MEDIA_TYPES.map(({ id, label, icon: Icon }) => {
                    const count = data.models.filter((item) => item.gatewayId === selectedGateway.id && item.mediaType === id).length;
                    return (
                      <button type="button" key={id} onClick={() => { setActiveMedia(id); setSyncResult(null); }}
                        className={`flex min-h-14 items-center justify-center gap-2 border-r border-[var(--border)] px-2 last:border-r-0 ${activeMedia === id ? 'bg-[var(--primary-muted)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-white/[0.025]'}`}>
                        <Icon size={16} className={activeMedia === id ? 'text-[var(--primary)]' : ''} />
                        <span className="text-xs font-semibold">{label}</span><span className="text-[9px] text-[var(--soft)]">{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div>
                    <div className="text-xs font-semibold">{MEDIA_TYPES.find((item) => item.id === activeMedia)?.label}模型映射</div>
                    <div className="mt-0.5 text-[10px] text-[var(--soft)]">一个渠道可绑定多个模型；优先级按逻辑模型分别计算</div>
                  </div>
                  <button type="button" onClick={() => openNewModel()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-[11px] hover:bg-white/5">
                    <Plus size={13} />添加模型
                  </button>
                </div>

                {syncResult && (
                  <div className="mx-4 mb-3 border border-[var(--border)] bg-black/15 p-3 sm:mx-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold">同步结果</span>
                      <button type="button" title="关闭同步结果" aria-label="关闭同步结果" onClick={() => setSyncResult(null)} className="text-[var(--soft)] hover:text-[var(--text)]"><X size={14} /></button>
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--muted)]">发现 {syncResult.modelIds.length} 个，未配置 {syncResult.discovered.length} 个，网关中缺失 {syncResult.configuredMissing.length} 个。</div>
                    {syncResult.discovered.length > 0 && (
                      <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                        {syncResult.discovered.map((id) => (
                          <button key={id} type="button" onClick={() => openNewModel(id)}
                            className="max-w-full truncate rounded border border-[var(--border)] px-2 py-1 font-mono text-[9px] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--text)]" title={`添加 ${id}`}>
                            + {id}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="border-t border-[var(--border)]">
                  {gatewayModels.length === 0 ? (
                    <div className="grid h-28 place-items-center text-xs text-[var(--soft)]">该渠道尚未配置{MEDIA_TYPES.find((item) => item.id === activeMedia)?.label}模型</div>
                  ) : gatewayModels.map((model) => {
                    const result = tests[`m:${model.id}`];
                    return (
                      <div key={model.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-[58px_minmax(180px,.8fr)_minmax(210px,1.2fr)_auto] sm:px-5">
                        <div>
                          <div className="text-[9px] text-[var(--soft)]">PRIORITY</div>
                          <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--primary)]">{model.priority}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><StatusDot enabled={model.status === 'active'} /><span className="truncate text-xs font-semibold">{model.displayName}</span></div>
                          <div className="mt-1 truncate font-mono text-[9px] text-[var(--soft)]">{model.modelKey}</div>
                          {result && <div className={`mt-1 truncate text-[9px] ${result.ok === true ? 'text-emerald-300' : result.ok === false ? 'text-rose-300' : 'text-[var(--soft)]'}`} title={result.text}>{result.text}</div>}
                        </div>
                        <div className="hidden min-w-0 sm:block">
                          <div className="truncate font-mono text-[10px] text-[var(--text)]">{model.upstreamModelId}</div>
                          <div className="mt-1 truncate text-[9px] text-[var(--soft)]">{data.protocols[activeMedia]?.find((item) => item.id === model.protocol)?.label || model.protocol}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <IconButton title="测试模型" onClick={() => void testTarget({ gatewayModelId: model.id }, `m:${model.id}`)}>{result && result.ok === undefined ? <CircleNotch size={14} className="animate-spin" /> : <Pulse size={14} />}</IconButton>
                          <IconButton title={model.status === 'active' ? '停用映射' : '启用映射'} tone={model.status === 'active' ? 'active' : 'normal'} onClick={() => void toggleModel(model)}><Power size={14} /></IconButton>
                          <IconButton title="编辑映射" onClick={() => openEditModel(model)}><PencilSimple size={14} /></IconButton>
                          <IconButton title="删除映射" tone="danger" onClick={() => void removeModel(model)}><Trash size={14} /></IconButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-[var(--border)]">
        <div className="flex items-end justify-between gap-3 px-4 py-4 sm:px-5">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.14em] text-[var(--primary)]">LOGICAL MODEL CATALOG</div>
            <h3 className="mt-1 text-sm font-semibold">逻辑模型目录</h3>
            <p className="mt-1 text-[10px] text-[var(--soft)]">同一逻辑模型跨多个 NewAPI 渠道只向用户展示一次。</p>
          </div>
          <span className="text-[10px] text-[var(--muted)]">{data.profiles.length} 个模型</span>
        </div>
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="text-[9px] tracking-wider text-[var(--soft)]">
              <tr>
                <th className="px-5 py-2.5 font-medium">逻辑模型</th>
                <th className="px-3 py-2.5 font-medium">类型</th>
                <th className="px-3 py-2.5 font-medium">任务角色</th>
                <th className="px-3 py-2.5 font-medium">路由</th>
                <th className="px-3 py-2.5 font-medium">策略</th>
                <th className="px-5 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {data.profiles.map((profile) => {
                const routeCount = data.models.filter((item) => item.modelProfileId === profile.id && item.status === 'active').length;
                return (
                  <tr key={profile.id} className="text-[11px] hover:bg-white/[0.02]">
                    <td className="px-5 py-3"><div className="font-semibold">{profile.displayName}</div><div className="mt-1 font-mono text-[9px] text-[var(--soft)]">{profile.modelKey}</div></td>
                    <td className="px-3 py-3 text-[var(--muted)]">{MEDIA_TYPES.find((item) => item.id === profile.mediaType)?.label}</td>
                    <td className="max-w-[260px] px-3 py-3 text-[10px] text-[var(--muted)]">{profile.taskKinds.join(' · ')}</td>
                    <td className="px-3 py-3 tabular-nums">{routeCount} 个启用映射</td>
                    <td className="px-3 py-3 text-[10px] text-[var(--muted)]">{profile.routePolicy === 'pinned' ? '固定渠道' : '优先级故障转移'}</td>
                    <td className="px-5 py-3"><div className="flex justify-end gap-1"><IconButton title="编辑逻辑模型" onClick={() => openEditProfile(profile)}><PencilSimple size={14} /></IconButton><IconButton title="删除逻辑模型" tone="danger" onClick={() => void removeProfile(profile)}><Trash size={14} /></IconButton></div></td>
                  </tr>
                );
              })}
              {data.profiles.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-[var(--soft)]">逻辑模型会在添加第一个渠道模型时创建</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {gatewayForm && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={gatewayForm.id ? '编辑渠道' : '新增渠道'}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[#121214] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[#121214] px-5 py-4">
              <div><div className="text-[10px] tracking-wider text-[var(--primary)]">NEWAPI GATEWAY</div><h3 className="mt-1 text-base font-semibold">{gatewayForm.id ? '编辑渠道' : '新增渠道'}</h3></div>
              <IconButton title="关闭" onClick={() => setGatewayForm(null)}><X size={16} /></IconButton>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">渠道名称</span><input value={gatewayForm.name} onChange={(event) => setGatewayForm({ ...gatewayForm, name: event.target.value })} placeholder="例如：NewAPI 主站" className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" /></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">请求超时（毫秒）</span><input type="number" min={5000} max={900000} value={gatewayForm.timeoutMs} onChange={(event) => setGatewayForm({ ...gatewayForm, timeoutMs: Number(event.target.value) })} className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" /></label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">Base URL</span><input value={gatewayForm.baseUrl} onChange={(event) => setGatewayForm({ ...gatewayForm, baseUrl: event.target.value })} placeholder="https://newapi.example.com" className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" /></label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[11px] text-[var(--muted)]">API Key</span>
                <span className="relative block"><Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--soft)]" /><input type={showApiKey ? 'text' : 'password'} value={gatewayForm.apiKey} onChange={(event) => setGatewayForm({ ...gatewayForm, apiKey: event.target.value })} placeholder={gatewayForm.id ? '已配置，留空保持不变' : '输入 NewAPI API Key'} className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 pl-9 pr-10 text-xs outline-none focus:border-[var(--primary)]" /><button type="button" title={showApiKey ? '隐藏密钥' : '显示密钥'} aria-label={showApiKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--soft)] hover:text-[var(--text)]">{showApiKey ? <EyeSlash size={15} /> : <Eye size={15} />}</button></span>
              </label>
              <label className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2.5 sm:col-span-2"><span className="text-xs">启用渠道</span><input type="checkbox" checked={gatewayForm.enabled} onChange={(event) => setGatewayForm({ ...gatewayForm, enabled: event.target.checked })} className="h-4 w-4 accent-[var(--primary)]" /></label>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border)] bg-[#121214] px-5 py-4"><button type="button" onClick={() => setGatewayForm(null)} className="h-9 rounded-md px-3 text-xs text-[var(--muted)] hover:bg-white/5">取消</button><button type="button" onClick={() => void saveGateway()} disabled={busy === 'save'} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[#17130a] disabled:opacity-40">{busy === 'save' && <CircleNotch size={13} className="animate-spin" />}保存渠道</button></div>
          </div>
        </div>
      )}

      {modelForm && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={modelForm.id ? '编辑模型映射' : '添加模型映射'}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[#121214] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[#121214] px-5 py-4">
              <div><div className="text-[10px] tracking-wider text-[var(--primary)]">GATEWAY MODEL ROUTE</div><h3 className="mt-1 text-base font-semibold">{modelForm.id ? '编辑模型映射' : `添加${MEDIA_TYPES.find((item) => item.id === modelForm.mediaType)?.label}模型`}</h3></div>
              <IconButton title="关闭" onClick={() => setModelForm(null)}><X size={16} /></IconButton>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {!modelForm.id && (
                <label className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2.5 sm:col-span-2"><span><span className="block text-xs">创建新的逻辑模型</span><span className="mt-0.5 block text-[9px] text-[var(--soft)]">关闭后可绑定另一个渠道已经创建的同一逻辑模型</span></span><input type="checkbox" checked={modelForm.createProfile} onChange={(event) => setModelForm({ ...modelForm, createProfile: event.target.checked })} className="h-4 w-4 accent-[var(--primary)]" /></label>
              )}
              {modelForm.createProfile ? (
                <>
                  <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">逻辑模型 Key</span><input value={modelForm.modelKey} onChange={(event) => setModelForm({ ...modelForm, modelKey: event.target.value })} placeholder="seedance-2.0-720p" className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 font-mono text-xs outline-none focus:border-[var(--primary)]" /></label>
                  <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">用户看到的名称</span><input value={modelForm.displayName} onChange={(event) => setModelForm({ ...modelForm, displayName: event.target.value })} placeholder="Seedance 2.0 720P" className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" /></label>
                </>
              ) : (
                <label className="block sm:col-span-2"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">绑定逻辑模型</span><select value={modelForm.modelProfileId} disabled={!!modelForm.id} onChange={(event) => setModelForm({ ...modelForm, modelProfileId: event.target.value })} className="h-10 w-full rounded-md border border-[var(--border)] bg-[#111113] px-3 text-xs outline-none disabled:opacity-55">{activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.modelKey}</option>)}</select></label>
              )}
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">该渠道的真实模型 ID</span><input value={modelForm.upstreamModelId} onChange={(event) => setModelForm({ ...modelForm, upstreamModelId: event.target.value })} placeholder="NewAPI /v1/models 返回的模型 ID" className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 font-mono text-xs outline-none focus:border-[var(--primary)]" /></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">接口协议</span><select value={modelForm.protocol} onChange={(event) => setModelForm({ ...modelForm, protocol: event.target.value })} className="h-10 w-full rounded-md border border-[var(--border)] bg-[#111113] px-3 text-xs outline-none">{data.protocols[modelForm.mediaType]?.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label}</option>)}</select></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">映射优先级</span><input type="number" min={1} max={9999} value={modelForm.priority} onChange={(event) => setModelForm({ ...modelForm, priority: Number(event.target.value) })} className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" /></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">状态</span><select value={modelForm.status} onChange={(event) => setModelForm({ ...modelForm, status: event.target.value as Status })} className="h-10 w-full rounded-md border border-[var(--border)] bg-[#111113] px-3 text-xs outline-none"><option value="active">启用</option><option value="disabled">停用</option><option value="revoked">撤销</option></select></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">同源接口路径覆盖（可选）</span><input value={modelForm.endpointPathOverride} onChange={(event) => setModelForm({ ...modelForm, endpointPathOverride: event.target.value })} placeholder="/v1/videos" className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 font-mono text-xs outline-none focus:border-[var(--primary)]" /></label>
              <JsonField label="映射能力覆盖 JSON" value={modelForm.capabilitiesOverride} onChange={(value) => setModelForm({ ...modelForm, capabilitiesOverride: value })} />
              <JsonField label="映射参数覆盖 JSON" value={modelForm.parametersOverride} onChange={(value) => setModelForm({ ...modelForm, parametersOverride: value })} />
              <JsonField label="协议选项 JSON" value={modelForm.protocolOptions} onChange={(value) => setModelForm({ ...modelForm, protocolOptions: value })} />
              {modelForm.mediaType === 'audio' && (
                <JsonField label="音色映射 JSON" value={modelForm.voiceMap} onChange={(value) => setModelForm({ ...modelForm, voiceMap: value })} />
              )}
              <div className={modelForm.mediaType === 'audio' ? '' : 'sm:col-span-2'}>
                <JsonField label="映射价格覆盖 JSON" value={modelForm.pricingOverride} onChange={(value) => setModelForm({ ...modelForm, pricingOverride: value })} />
              </div>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border)] bg-[#121214] px-5 py-4"><button type="button" onClick={() => setModelForm(null)} className="h-9 rounded-md px-3 text-xs text-[var(--muted)] hover:bg-white/5">取消</button><button type="button" onClick={() => void saveModel()} disabled={busy === 'save'} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[#17130a] disabled:opacity-40">{busy === 'save' && <CircleNotch size={13} className="animate-spin" />}保存映射</button></div>
          </div>
        </div>
      )}

      {profileForm && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="编辑逻辑模型">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[#121214] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[#121214] px-5 py-4">
              <div><div className="text-[10px] tracking-wider text-[var(--primary)]">LOGICAL MODEL PROFILE</div><h3 className="mt-1 text-base font-semibold">编辑逻辑模型</h3></div>
              <IconButton title="关闭" onClick={() => setProfileForm(null)}><X size={16} /></IconButton>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">modelKey（创建后不可修改）</span><input value={profileForm.modelKey} disabled className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 font-mono text-xs opacity-60" /></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">用户看到的名称</span><input value={profileForm.displayName} onChange={(event) => setProfileForm({ ...profileForm, displayName: event.target.value })} className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" /></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">状态</span><select value={profileForm.status} onChange={(event) => setProfileForm({ ...profileForm, status: event.target.value as Status })} className="h-10 w-full rounded-md border border-[var(--border)] bg-[#111113] px-3 text-xs"><option value="active">启用</option><option value="disabled">停用</option><option value="revoked">撤销</option></select></label>
              <label className="block"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">显示顺序</span><input type="number" min={1} max={9999} value={profileForm.sortOrder} onChange={(event) => setProfileForm({ ...profileForm, sortOrder: Number(event.target.value) })} className="h-10 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" /></label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-[11px] text-[var(--muted)]">网关路由策略</span><select value={profileForm.routePolicy} onChange={(event) => setProfileForm({ ...profileForm, routePolicy: event.target.value as RoutePolicy })} className="h-10 w-full rounded-md border border-[var(--border)] bg-[#111113] px-3 text-xs"><option value="priority_failover">按映射优先级故障转移</option><option value="pinned">固定到最高优先级映射</option></select></label>
              <fieldset className="border border-[var(--border)] p-3 sm:col-span-2">
                <legend className="px-1 text-[11px] text-[var(--muted)]">允许的任务角色与默认模型</legend>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  {(data.taskKinds[profileForm.mediaType] || []).map((task) => {
                    const enabled = profileForm.taskKinds.includes(task);
                    return (
                      <div key={task} className="flex items-center justify-between gap-3 rounded-md bg-black/15 px-3 py-2">
                        <label className="flex min-w-0 items-center gap-2 text-[10px]"><input type="checkbox" checked={enabled} onChange={(event) => switchTask(task, event.target.checked)} className="h-3.5 w-3.5 accent-[var(--primary)]" /><span className="truncate font-mono">{task}</span></label>
                        <label className={`flex items-center gap-1.5 text-[9px] ${enabled ? 'text-[var(--muted)]' : 'text-[var(--soft)] opacity-40'}`}><input type="checkbox" disabled={!enabled} checked={profileForm.isDefaultFor.includes(task)} onChange={(event) => setProfileForm({ ...profileForm, isDefaultFor: event.target.checked ? [...new Set([...profileForm.isDefaultFor, task])] : profileForm.isDefaultFor.filter((item) => item !== task) })} className="h-3.5 w-3.5 accent-[var(--primary)]" />默认</label>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <JsonField label="能力配置 JSON" value={profileForm.capabilities} onChange={(value) => setProfileForm({ ...profileForm, capabilities: value })} />
              <JsonField label="默认参数 JSON" value={profileForm.defaultParameters} onChange={(value) => setProfileForm({ ...profileForm, defaultParameters: value })} />
              <div className="sm:col-span-2"><JsonField label="锁定参数 JSON（用户请求不可覆盖）" value={profileForm.lockedParameters} onChange={(value) => setProfileForm({ ...profileForm, lockedParameters: value })} /></div>
              <JsonField label="价格策略 JSON" value={profileForm.pricingPolicy} onChange={(value) => setProfileForm({ ...profileForm, pricingPolicy: value })} />
              <JsonField label="访问策略 JSON" value={profileForm.accessPolicy} onChange={(value) => setProfileForm({ ...profileForm, accessPolicy: value })} />
              <div className="sm:col-span-2"><JsonField label="调用限制 JSON" value={profileForm.limits} onChange={(value) => setProfileForm({ ...profileForm, limits: value })} /></div>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--border)] bg-[#121214] px-5 py-4"><button type="button" onClick={() => setProfileForm(null)} className="h-9 rounded-md px-3 text-xs text-[var(--muted)] hover:bg-white/5">取消</button><button type="button" onClick={() => void saveProfile()} disabled={busy === 'save'} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-[#17130a] disabled:opacity-40">{busy === 'save' && <CircleNotch size={13} className="animate-spin" />}保存逻辑模型</button></div>
          </div>
        </div>
      )}
    </section>
  );
}

