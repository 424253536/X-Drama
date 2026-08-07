'use client';

import { useEffect, useMemo, useState } from 'react';
import { CircleNotch, SlidersHorizontal } from '@phosphor-icons/react';
import { getToken } from '@/lib/auth';
import type { AudioStrategy, ModelCatalogItem, ModelSelections } from '@/lib/model-routing';

const SELECTORS = [
  { mediaType: 'text', taskKind: 'text.default', label: '文本模型' },
  { mediaType: 'image', taskKind: 'image.default', label: '图像模型' },
  { mediaType: 'video', taskKind: 'video.default', label: '视频模型' },
  { mediaType: 'audio', taskKind: 'audio.tts', label: '声音模型' },
] as const;

const SELECTIONS_STORAGE_KEY = 'qfmj-model-selections-v2';
const AUDIO_STRATEGY_STORAGE_KEY = 'qfmj-audio-strategy-v2';

interface ModelSelectionPanelProps {
  value: ModelSelections;
  onChange: (value: ModelSelections) => void;
  audioStrategy?: AudioStrategy;
  onAudioStrategyChange?: (value: AudioStrategy) => void;
  className?: string;
}

export function ModelSelectionPanel({
  value,
  onChange,
  audioStrategy = 'separate',
  onAudioStrategyChange,
  className = '',
}: ModelSelectionPanelProps) {
  const [models, setModels] = useState<ModelCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      const rawSelections = localStorage.getItem(SELECTIONS_STORAGE_KEY);
      if (rawSelections) {
        const parsed = JSON.parse(rawSelections);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          onChange({ ...(parsed as ModelSelections), ...value });
        }
      }
      const storedStrategy = localStorage.getItem(AUDIO_STRATEGY_STORAGE_KEY);
      if (onAudioStrategyChange && (storedStrategy === 'native' || storedStrategy === 'hybrid' || storedStrategy === 'separate')) {
        onAudioStrategyChange(storedStrategy);
      }
    } catch { /* ignore invalid browser storage */ }
    setStorageReady(true);
    // Parent callbacks are intentionally sampled once while restoring persisted creation defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem(SELECTIONS_STORAGE_KEY, JSON.stringify(value));
      localStorage.setItem(AUDIO_STRATEGY_STORAGE_KEY, audioStrategy);
    } catch { /* ignore unavailable browser storage */ }
  }, [audioStrategy, storageReady, value]);

  useEffect(() => {
    const token = getToken();
    void fetch('/api/model-catalog', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || '模型目录读取失败');
        setModels(body.models || []);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '模型目录读取失败'))
      .finally(() => setLoading(false));
  }, []);

  const byTask = useMemo(() => Object.fromEntries(
    SELECTORS.map((selector) => [
      selector.taskKind,
      models.filter((model) =>
        model.mediaType === selector.mediaType && model.taskKinds.includes(selector.taskKind)),
    ]),
  ) as Record<string, ModelCatalogItem[]>, [models]);

  useEffect(() => {
    if (!models.length) return;
    const next = { ...value };
    let changed = false;
    for (const selector of SELECTORS) {
      const candidates = byTask[selector.taskKind] || [];
      if (!candidates.length || candidates.some((model) => model.modelKey === next[selector.taskKind])) continue;
      next[selector.taskKind] = (
        candidates.find((model) => model.isDefaultFor.includes(selector.taskKind)) || candidates[0]
      ).modelKey;
      changed = true;
    }
    if (changed) onChange(next);
  }, [byTask, models, onChange, value]);

  return (
    <div className={`border border-white/10 bg-black/20 p-3 ${className}`} data-testid="model-selection-panel">
      <div className="mb-3 flex items-center gap-2">
        <SlidersHorizontal size={15} className="text-[var(--cinema-amber,var(--primary))]" />
        <span className="text-[11px] font-semibold tracking-wide text-white/75">生成模型</span>
        {loading && <CircleNotch size={13} className="animate-spin text-white/45" />}
      </div>
      {error ? (
        <div className="text-xs text-rose-300">{error}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SELECTORS.map((selector) => {
            const candidates = byTask[selector.taskKind] || [];
            return (
              <label key={selector.taskKind} className="min-w-0">
                <span className="mb-1 block text-[10px] text-white/45">{selector.label}</span>
                <select
                  value={value[selector.taskKind] || ''}
                  disabled={loading || candidates.length === 0}
                  onChange={(event) => onChange({ ...value, [selector.taskKind]: event.target.value })}
                  className="h-9 w-full border border-white/10 bg-[#111113] px-2 text-xs text-white outline-none focus:border-[var(--cinema-amber,var(--primary))] disabled:opacity-45"
                >
                  {candidates.length === 0 && <option value="">沿用旧版自动路由</option>}
                  {candidates.map((model) => (
                    <option key={model.modelKey} value={model.modelKey}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
                {candidates.length > 0 && value[selector.taskKind] && (
                  <span className="mt-1 block truncate text-[9px] text-white/30">
                    {value[selector.taskKind]}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
      {onAudioStrategyChange && (byTask['video.default'] || []).some((model) =>
        model.modelKey === value['video.default'] && model.capabilities.nativeAudio === true) && (
        <label className="mt-3 block max-w-xs">
          <span className="mb-1 block text-[10px] text-white/45">音频策略</span>
          <select
            value={audioStrategy}
            onChange={(event) => onAudioStrategyChange(event.target.value as AudioStrategy)}
            className="h-9 w-full border border-white/10 bg-[#111113] px-2 text-xs text-white outline-none"
          >
            <option value="separate">独立配音、音乐与音效</option>
            <option value="native">使用视频模型原生音频</option>
            <option value="hybrid">原生环境音 + 独立对白</option>
          </select>
        </label>
      )}
    </div>
  );
}
