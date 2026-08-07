'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChatCircle,
  CheckCircle,
  CircleNotch,
  Eye,
  EyeSlash,
  FilmStrip,
  ImageSquare,
  Keyhole,
  PencilSimple,
  Plus,
  Power,
  Pulse,
  SpeakerHigh,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { getToken } from '@/lib/auth';
import type {
  ApiChannelExtraField,
  ApiChannelFormatDefinition,
  ApiChannelType,
} from '@/lib/api-channel-types';

interface ChannelView {
  id: string;
  type: ApiChannelType;
  name: string;
  format: string;
  baseUrl: string;
  model: string;
  priority: number;
  enabled: boolean;
  options: Record<string, string | number | boolean>;
  apiKeyConfigured: boolean;
  maskedApiKey: string | null;
  secretConfigured: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

interface ChannelForm {
  type: ApiChannelType;
  name: string;
  format: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  priority: number;
  enabled: boolean;
  options: Record<string, string | number | boolean>;
  secrets: Record<string, string>;
}

const TYPE_META: Record<ApiChannelType, { label: string; eyebrow: string; icon: typeof ChatCircle }> = {
  text: { label: '文本', eyebrow: 'TEXT', icon: ChatCircle },
  image: { label: '图像', eyebrow: 'IMAGE', icon: ImageSquare },
  video: { label: '视频', eyebrow: 'VIDEO', icon: FilmStrip },
  audio: { label: '声音', eyebrow: 'AUDIO', icon: SpeakerHigh },
};

function headers(json = false): HeadersInit {
  const token = getToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function defaultValues(definition: ApiChannelFormatDefinition) {
  return Object.fromEntries(
    definition.extraFields
      .filter((field) => field.kind !== 'secret' && field.defaultValue !== undefined)
      .map((field) => [field.key, field.kind === 'boolean' ? field.defaultValue === 'true' : field.defaultValue || '']),
  );
}

function newForm(type: ApiChannelType, formats: ApiChannelFormatDefinition[]): ChannelForm {
  const definition = formats.find((item) => item.type === type)!;
  return {
    type,
    name: '',
    format: definition?.format || '',
    baseUrl: definition?.defaultBaseUrl || '',
    model: definition?.defaultModel || '',
    apiKey: '',
    priority: 100,
    enabled: true,
    options: definition ? defaultValues(definition) : {},
    secrets: {},
  };
}

export function ApiChannelManager() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [formats, setFormats] = useState<ApiChannelFormatDefinition[]>([]);
  const [activeType, setActiveType] = useState<ApiChannelType>('text');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ChannelForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  /** 渠道测活状态: id → 进行中/结果 */
  const [testResults, setTestResults] = useState<Record<string, { status: 'loading' | 'ok' | 'fail'; text: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/api-channels', { headers: headers(), cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '读取渠道失败');
      setChannels(body.channels || []);
      setFormats(body.formats || []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '读取渠道失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeChannels = useMemo(
    () => channels.filter((channel) => channel.type === activeType).sort((a, b) => a.priority - b.priority),
    [activeType, channels],
  );
  const activeFormats = useMemo(() => formats.filter((item) => item.type === activeType), [activeType, formats]);
  const definition = form ? formats.find((item) => item.type === form.type && item.format === form.format) : undefined;

  const openNew = () => {
    setEditingId(null);
    setForm(newForm(activeType, formats));
    setVisible(new Set());
    setMessage(null);
  };

  const openEdit = (channel: ChannelView) => {
    setEditingId(channel.id);
    setForm({
      type: channel.type,
      name: channel.name,
      format: channel.format,
      baseUrl: channel.baseUrl,
      model: channel.model,
      apiKey: '',
      priority: channel.priority,
      enabled: channel.enabled,
      options: channel.options || {},
      secrets: {},
    });
    setVisible(new Set());
    setMessage(null);
  };

  const changeFormat = (format: string) => {
    if (!form) return;
    const next = formats.find((item) => item.type === form.type && item.format === format);
    if (!next) return;
    setForm({
      ...form,
      format,
      baseUrl: next.defaultBaseUrl,
      model: next.defaultModel,
      options: defaultValues(next),
      secrets: {},
    });
  };

  const mutationFor = (source: ChannelForm) => ({
    type: source.type,
    name: source.name,
    format: source.format,
    baseUrl: source.baseUrl,
    model: source.model,
    priority: source.priority,
    enabled: source.enabled,
    options: source.options,
    ...(source.apiKey.trim() ? { apiKey: source.apiKey.trim() } : {}),
    secrets: Object.fromEntries(Object.entries(source.secrets).filter(([, value]) => value.trim())),
  });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/settings/api-channels', {
        method: editingId ? 'PATCH' : 'POST',
        headers: headers(true),
        body: JSON.stringify(editingId ? { id: editingId, channel: mutationFor(form) } : mutationFor(form)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '保存渠道失败');
      setChannels(body.channels || []);
      setForm(null);
      setEditingId(null);
      setMessage({ type: 'success', text: '渠道已保存并立即加入运行时调用链。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存渠道失败' });
    } finally {
      setSaving(false);
    }
  };

  const updateChannel = async (channel: ChannelView, enabled: boolean) => {
    setMessage(null);
    try {
      const response = await fetch('/api/settings/api-channels', {
        method: 'PATCH', headers: headers(true),
        body: JSON.stringify({
          id: channel.id,
          channel: {
            type: channel.type, name: channel.name, format: channel.format,
            baseUrl: channel.baseUrl, model: channel.model, priority: channel.priority,
            enabled, options: channel.options,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '更新渠道失败');
      setChannels(body.channels || []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '更新渠道失败' });
    }
  };

  const testChannel = async (channel: ChannelView) => {
    setTestResults((current) => ({ ...current, [channel.id]: { status: 'loading', text: '测试中…' } }));
    try {
      const response = await fetch('/api/settings/api-channels/test', {
        method: 'POST', headers: headers(true), body: JSON.stringify({ id: channel.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '测试失败');
      setTestResults((current) => ({
        ...current,
        [channel.id]: body.ok
          ? { status: 'ok', text: body.detail || `连通正常 (${body.elapsedMs} ms)` }
          : { status: 'fail', text: body.detail || '测试失败' },
      }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [channel.id]: { status: 'fail', text: error instanceof Error ? error.message : '测试失败' },
      }));
    }
  };

  const remove = async (channel: ChannelView) => {
    if (!window.confirm(`删除渠道“${channel.name}”？`)) return;
    setMessage(null);
    try {
      const response = await fetch('/api/settings/api-channels', {
        method: 'DELETE', headers: headers(true), body: JSON.stringify({ id: channel.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '删除渠道失败');
      setChannels(body.channels || []);
      setMessage({ type: 'success', text: '渠道已删除。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除渠道失败' });
    }
  };

  const renderExtraField = (field: ApiChannelExtraField) => {
    if (!form) return null;
    const configured = editingId
      ? channels.find((channel) => channel.id === editingId)?.secretConfigured[field.key]
      : false;
    if (field.kind === 'boolean') {
      return (
        <label key={field.key} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5">
          <span className="text-xs text-[var(--text)]">{field.label}</span>
          <input
            type="checkbox"
            checked={Boolean(form.options[field.key])}
            onChange={(event) => setForm({ ...form, options: { ...form.options, [field.key]: event.target.checked } })}
            className="h-4 w-4 accent-[var(--primary)]"
          />
        </label>
      );
    }
    const isSecret = field.kind === 'secret';
    const value = isSecret ? form.secrets[field.key] || '' : String(form.options[field.key] ?? '');
    const isVisible = visible.has(field.key);
    return (
      <label key={field.key} className="block">
        <span className="mb-1.5 block text-[11px] text-[var(--muted)]">{field.label}</span>
        <span className="relative block">
          {isSecret && <Keyhole size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--soft)]" />}
          <input
            type={isSecret && !isVisible ? 'password' : field.kind === 'number' ? 'number' : 'text'}
            value={value}
            placeholder={isSecret && configured ? '已配置，留空保持不变' : field.placeholder || field.defaultValue || ''}
            onChange={(event) => isSecret
              ? setForm({ ...form, secrets: { ...form.secrets, [field.key]: event.target.value } })
              : setForm({ ...form, options: { ...form.options, [field.key]: event.target.value } })}
            className={`h-10 w-full rounded-lg border border-[var(--border)] bg-black/20 text-xs outline-none focus:border-[var(--primary)] ${isSecret ? 'pl-9 pr-10' : 'px-3'}`}
          />
          {isSecret && (
            <button
              type="button" title={isVisible ? '隐藏' : '显示'}
              onClick={() => setVisible((current) => {
                const next = new Set(current);
                if (next.has(field.key)) next.delete(field.key); else next.add(field.key);
                return next;
              })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--soft)] hover:text-[var(--text)]"
            >
              {isVisible ? <EyeSlash size={14} /> : <Eye size={14} />}
            </button>
          )}
        </span>
      </label>
    );
  };

  return (
    <section className="mb-6 border-y border-[var(--border)] bg-[rgba(18,18,20,0.55)]">
      <div className="px-4 sm:px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] tracking-[0.16em] text-[var(--primary)] font-semibold">CHANNEL ORCHESTRATION</div>
          <h2 className="mt-1 text-lg font-semibold">渠道编排</h2>
        </div>
        <button
          onClick={openNew}
          disabled={!formats.length}
          className="h-9 px-3 rounded-lg bg-[var(--primary)] text-[#17130a] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          <Plus size={14} weight="bold" />新增渠道
        </button>
      </div>

      <div className="grid grid-cols-4 border-y border-[var(--border)]">
        {(Object.keys(TYPE_META) as ApiChannelType[]).map((type) => {
          const meta = TYPE_META[type];
          const Icon = meta.icon;
          const active = activeType === type;
          const count = channels.filter((channel) => channel.type === type && channel.enabled).length;
          return (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={`min-h-16 px-2 sm:px-4 border-r last:border-r-0 border-[var(--border)] flex items-center justify-center sm:justify-start gap-2 transition-colors ${active ? 'bg-[var(--primary-muted)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-white/[0.025]'}`}
            >
              <Icon size={17} className={active ? 'text-[var(--primary)]' : ''} />
              <span className="hidden sm:block text-left">
                <span className="block text-xs font-semibold">{meta.label}</span>
                <span className="block text-[9px] text-[var(--soft)]">{count} ENABLED</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-h-32">
        {loading ? (
          <div className="h-32 grid place-items-center text-[var(--muted)]"><CircleNotch size={18} className="animate-spin" /></div>
        ) : activeChannels.length === 0 ? (
          <div className="h-32 grid place-items-center text-xs text-[var(--soft)]">暂无{TYPE_META[activeType].label}渠道</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {activeChannels.map((channel, index) => {
              const format = activeFormats.find((item) => item.format === channel.format);
              return (
                <div key={channel.id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] sm:grid-cols-[70px_minmax(180px,0.7fr)_minmax(220px,1.3fr)_auto] gap-3 items-center px-4 sm:px-5 py-3.5">
                  <div className="text-center">
                    <div className="text-[9px] text-[var(--soft)]">P{index + 1}</div>
                    <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--primary)]">{channel.priority}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold">{channel.name}</span>
                      <span className={`h-1.5 w-1.5 rounded-full ${channel.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--muted)] truncate">{format?.label || channel.format}</div>
                    {testResults[channel.id] && (
                      <div
                        className={`mt-1 text-[10px] leading-4 ${
                          testResults[channel.id].status === 'ok' ? 'text-emerald-300'
                            : testResults[channel.id].status === 'fail' ? 'text-rose-300'
                              : 'text-[var(--soft)]'
                        }`}
                        title={testResults[channel.id].text}
                      >
                        {testResults[channel.id].status === 'ok' ? '✓ ' : testResults[channel.id].status === 'fail' ? '✗ ' : ''}
                        {testResults[channel.id].text}
                      </div>
                    )}
                  </div>
                  <div className="hidden sm:block min-w-0">
                    <div className="text-[11px] text-[var(--text)] truncate">{channel.model || '无模型 ID'}</div>
                    <div className="mt-1 text-[10px] text-[var(--soft)] truncate">{channel.baseUrl}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button" title="测活:文本渠道发一次真实小对话,其它格式做鉴权检查"
                      disabled={testResults[channel.id]?.status === 'loading'}
                      onClick={() => void testChannel(channel)}
                      className="h-8 w-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-[var(--primary)] hover:bg-white/5 disabled:opacity-40"
                    >{testResults[channel.id]?.status === 'loading' ? <CircleNotch size={14} className="animate-spin" /> : <Pulse size={14} />}</button>
                    <button
                      type="button" title={channel.enabled ? '停用' : '启用'}
                      onClick={() => void updateChannel(channel, !channel.enabled)}
                      className={`h-8 w-8 grid place-items-center rounded-lg hover:bg-white/5 ${channel.enabled ? 'text-emerald-300' : 'text-[var(--soft)]'}`}
                    ><Power size={14} /></button>
                    <button type="button" title="编辑" onClick={() => openEdit(channel)} className="h-8 w-8 grid place-items-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5"><PencilSimple size={14} /></button>
                    <button type="button" title="删除" onClick={() => void remove(channel)} className="h-8 w-8 grid place-items-center rounded-lg text-[var(--soft)] hover:text-rose-300 hover:bg-rose-500/5"><Trash size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {message && (
        <div className={`mx-4 sm:mx-5 mb-4 rounded-lg border px-3 py-2.5 text-xs flex items-start gap-2 ${message.type === 'success' ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200' : 'border-rose-500/25 bg-rose-500/8 text-rose-200'}`}>
          {message.type === 'success' ? <CheckCircle size={15} /> : <WarningCircle size={15} />}
          <span>{message.text}</span>
        </div>
      )}

      {form && definition && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm grid place-items-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[#121214] shadow-2xl">
            <div className="sticky top-0 z-10 bg-[#121214] border-b border-[var(--border)] px-5 py-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] tracking-[0.14em] text-[var(--primary)]">{TYPE_META[form.type].eyebrow} CHANNEL</div>
                <h3 className="mt-1 text-base font-semibold">{editingId ? '编辑渠道' : '新增渠道'}</h3>
              </div>
              <button type="button" title="关闭" onClick={() => setForm(null)} className="h-8 w-8 grid place-items-center rounded-lg text-[var(--muted)] hover:bg-white/5"><X size={16} /></button>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[var(--muted)]">渠道名称</span>
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：主站 Gemini" className="h-10 w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[var(--muted)]">接口格式</span>
                <select value={form.format} onChange={(event) => changeFormat(event.target.value)} className="h-10 w-full rounded-lg border border-[var(--border)] bg-[#111113] px-3 text-xs outline-none focus:border-[var(--primary)]">
                  {activeFormats.map((item) => <option key={item.format} value={item.format}>{item.label}</option>)}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[11px] text-[var(--muted)]">Base URL</span>
                <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} className="h-10 w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[var(--muted)]">API Key / Access Key</span>
                <span className="relative block">
                  <Keyhole size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--soft)]" />
                  <input
                    type={visible.has('apiKey') ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                    placeholder={editingId ? '已配置，留空保持不变' : '输入密钥'}
                    className="h-10 w-full rounded-lg border border-[var(--border)] bg-black/20 pl-9 pr-10 text-xs outline-none focus:border-[var(--primary)]"
                  />
                  <button type="button" title={visible.has('apiKey') ? '隐藏' : '显示'} onClick={() => setVisible((current) => {
                    const next = new Set(current); if (next.has('apiKey')) next.delete('apiKey'); else next.add('apiKey'); return next;
                  })} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--soft)]">
                    {visible.has('apiKey') ? <EyeSlash size={14} /> : <Eye size={14} />}
                  </button>
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[var(--muted)]">模型 ID{definition.modelRequired ? '' : '（可选）'}</span>
                <input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} className="h-10 w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[var(--muted)]">优先级</span>
                <input type="number" min={1} max={9999} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} className="h-10 w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 text-xs outline-none focus:border-[var(--primary)]" />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 self-end">
                <span className="text-xs">启用渠道</span>
                <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
              </label>
              {definition.extraFields.map(renderExtraField)}
            </div>

            <div className="sticky bottom-0 bg-[#121214] border-t border-[var(--border)] px-5 py-4 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="h-9 px-3 rounded-lg text-xs text-[var(--muted)] hover:bg-white/5">取消</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="h-9 px-4 rounded-lg bg-[var(--primary)] text-[#17130a] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40">
                {saving && <CircleNotch size={13} className="animate-spin" />}保存渠道
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

