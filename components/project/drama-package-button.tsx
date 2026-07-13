'use client';

/**
 * DramaPackageButton — 出海打包入口组件(v12.188.1)
 * 调用 GET /api/series/[id]/drama-package,展示各集视频 URL/封面/定价建议,支持下载 JSON。
 * 文案均为中文字面量,需 i18n 时参见下方 I18N_KEYS 注释。
 *
 * I18N_KEYS(补进 i18n.ts seriesDetail 区):
 *   dramaPackageBtn        = "📦 出海打包"
 *   dramaPackageFetching   = "正在获取打包数据…"
 *   dramaPackageTitle      = "出海打包 · TikTok Drama Center"
 *   dramaPackageClose      = "关闭"
 *   dramaPackageDownload   = "下载 JSON"
 *   dramaPackageCoverLabel = "系列封面"
 *   dramaPackageEpFree     = "免费"
 *   dramaPackageEpCoins    = "{coins} coins"
 *   dramaPackageGuideTitle = "上传步骤"
 *   dramaPackageErrPrefix  = "获取失败:"
 */

import { useState } from 'react';
import { Package, CircleNotch as Loader2, X, DownloadSimple, Play } from '@phosphor-icons/react';

interface DramaEpisode { episodeNumber: number; title: string; videoUrl: string; durationSec?: number }
interface DramaPricing { episodeNumber: number; unlock: 'free' | 'coins'; coins: number }
interface DramaPackageResult {
  platform: string;
  series: { title: string; language: string; episodeCount: number; coverUrl: string | null; totalDurationSec: number };
  episodes: DramaEpisode[];
  pricing: DramaPricing[];
  uploadGuide: string[];
}

interface Props { seriesId: string }

export function DramaPackageButton({ seriesId }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [data, setData] = useState<DramaPackageResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [open, setOpen] = useState(false);

  const pricingMap = (data?.pricing ?? []).reduce<Record<number, DramaPricing>>((acc, p) => {
    acc[p.episodeNumber] = p;
    return acc;
  }, {});

  const fetch_ = async () => {
    if (state === 'loading') return;
    setState('loading');
    setErrMsg('');
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/drama-package`);
      const body = await res.json();
      if (!res.ok) { setState('error'); setErrMsg(body?.error || `HTTP ${res.status}`); return; }
      setData(body as DramaPackageResult);
      setState('done');
      setOpen(true);
    } catch (e) {
      setState('error');
      setErrMsg(e instanceof Error ? e.message : '网络错误');
    }
  };

  const downloadJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drama-package-${seriesId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* 入口按钮 */}
      <button
        onClick={() => { if (state === 'done' && data) { setOpen(true); } else { void fetch_(); } }}
        disabled={state === 'loading'}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-gray-200 text-xs hover:text-white disabled:opacity-40"
      >
        {state === 'loading'
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Package className="w-3.5 h-3.5" />}
        {state === 'loading' ? '正在获取打包数据…' : '📦 出海打包'}
      </button>

      {/* 错误内联提示 */}
      {state === 'error' && errMsg && (
        <span className="text-[11px] text-red-300">获取失败:{errMsg}</span>
      )}

      {/* 结果面板(内联展开) */}
      {open && data && (
        <div className="w-full mt-3 rounded-xl border border-white/10 bg-white/5 p-4 space-y-4 text-[13px]">
          {/* 标题栏 */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white text-sm">出海打包 · TikTok Drama Center</span>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadJson}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/15 text-gray-200 text-xs hover:text-white"
              >
                <DownloadSimple className="w-3.5 h-3.5" /> 下载 JSON
              </button>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 系列封面 + 基本信息 */}
          <div className="flex items-start gap-3">
            {data.series.coverUrl && (
              <div className="w-14 shrink-0 rounded-lg overflow-hidden bg-black/30 aspect-[3/4]">
                <img src={data.series.coverUrl} alt="系列封面" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="space-y-1 text-gray-300 text-[12px]">
              <div className="font-medium text-white">{data.series.title}</div>
              <div>语言:{data.series.language} · 共 {data.series.episodeCount} 集</div>
              {data.series.totalDurationSec > 0 && (
                <div>总时长:{Math.round(data.series.totalDurationSec / 60)} 分钟</div>
              )}
            </div>
          </div>

          {/* 各集列表 */}
          <div className="space-y-1.5">
            {data.episodes.map((ep) => {
              const price = pricingMap[ep.episodeNumber];
              return (
                <div key={ep.episodeNumber} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
                  <span className="text-cyan-400 font-bold w-10 shrink-0 text-[12px]">EP{ep.episodeNumber}</span>
                  <span className="flex-1 text-white text-[12px] truncate" title={ep.title}>{ep.title}</span>
                  {ep.durationSec != null && (
                    <span className="text-gray-500 text-[11px] font-mono shrink-0">{ep.durationSec}s</span>
                  )}
                  {price && (
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border shrink-0 ${price.unlock === 'free' ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`}>
                      {price.unlock === 'free' ? '免费' : `${price.coins} coins`}
                    </span>
                  )}
                  {ep.videoUrl && (
                    <a href={ep.videoUrl} target="_blank" rel="noreferrer" title="查看视频"
                      className="text-cyan-300 hover:text-cyan-200 shrink-0">
                      <Play className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {/* 上传步骤 */}
          {data.uploadGuide.length > 0 && (
            <div className="bg-black/20 rounded-lg px-3 py-2.5 space-y-1">
              <div className="text-[11px] font-semibold text-gray-400 mb-1">上传步骤</div>
              {data.uploadGuide.map((step, i) => (
                <div key={i} className="text-[11px] text-gray-400 leading-relaxed">{step}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
