'use client';

/**
 * /dashboard/comic · 漫转视频分格台(v12.250 前端入口 → v12.247 /api/comic/panels)
 *
 * 漫转视频模式的前端入口:传一张漫画 → 后端用投影法自动**分格**(检出每格边界框)→
 * 本页把格子框叠在原图上可视化。
 *
 * 诚实边界:本页只做**分格**(切出每格)。每格裁图 → u2v 加动效 → 卡点拼接成动态漫剧
 * 复用既有 generateVideo / video-composer,是下一步(页内如实标注)。
 * 投影法对条漫/规则网格准;不规则跨栏布局切不准(需 CV,暂不支持),后端 hint 会提示。
 */

import { useRef, useState } from 'react';
import { Upload, Link as LinkIcon, GridFour, Warning as AlertTriangle, CircleNotch as Loader2, Rows } from '@phosphor-icons/react';
import { useToast } from '@/components/ui/toast-provider';

interface Panel { x: number; y: number; w: number; h: number; row: number; col: number; }

// 分格框轮换配色(相邻格不同色,肉眼好数)。
const BOX_COLORS = ['#E8C547', '#4A7EBB', '#3F8F7A', '#C4576D', '#9B6DC4', '#D4883B'];

export default function ComicPanelsPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [summary, setSummary] = useState('');
  const [hint, setHint] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const { showToast } = useToast();

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { showToast({ title: '只能上传图片', type: 'error' }); return; }
    if (file.size > 10 * 1024 * 1024) { showToast({ title: '图片太大(上限 10MB)', type: 'error' }); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/upload/character-face', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast({ title: body.error || '上传失败', type: 'error' }); return; }
      resetResult();
      setImageUrl(body.url);
      setImagePreview(body.url);
    } catch (e) {
      // 断网/传输层失败:fetch 直接 throw,若不接住就是静默的未处理 rejection、用户毫无反馈。
      showToast({ title: e instanceof Error ? e.message : '上传失败,请检查网络', type: 'error' });
    }
  };

  const acceptUrl = async () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) { showToast({ title: 'URL 必须以 http(s):// 开头', type: 'error' }); return; }
    try {
      const res = await fetch('/api/upload/character-face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showToast({ title: body.error || 'URL 抓取失败', type: 'error' }); return; }
      resetResult();
      setImageUrl(body.url);
      setImagePreview(body.url);
      setShowUrlInput(false);
      setUrlDraft('');
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : 'URL 抓取失败,请检查网络', type: 'error' });
    }
  };

  const resetResult = () => { setPanels(null); setSummary(''); setHint(''); setErrorMsg(''); setNatural(null); };

  const detect = async () => {
    if (!imageUrl) { showToast({ title: '先上传一张漫画图', type: 'error' }); return; }
    setDetecting(true);
    setPanels(null); setErrorMsg(''); setHint('');
    try {
      const res = await fetch('/api/comic/panels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.message || `分格失败 (HTTP ${res.status})`;
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setPanels(body.panels || []);
      setSummary(body.summary || '');
      setHint(body.hint || '');
      showToast({ title: `检出 ${body.panelCount} 格`, type: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,分格失败';
      setErrorMsg(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GridFour className="w-6 h-6 text-[#E8C547]" weight="duotone" />
          漫转视频 · 分格台
        </h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          传一张漫画 → 投影法自动检出每格边界(条漫/规则网格最准)。分格后每格加动效 → 拼成动态漫剧(下一步)。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 输入区 */}
        <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <label className="text-xs text-[var(--soft)] uppercase tracking-wider">漫画图</label>
          <div
            onClick={() => !imagePreview && fileRef.current?.click()}
            className={`aspect-[3/4] max-h-[420px] rounded-xl overflow-hidden flex items-center justify-center border relative ${
              imagePreview ? 'border-[#E8C547]/30 bg-black/20' : 'cursor-pointer border-dashed border-white/15 bg-white/[0.02] hover:bg-white/5'
            }`}
          >
            {imagePreview ? (
              // 原图 + 分格框叠层。框用百分比定位,自适应任意显示尺寸。
              <div className="relative w-full h-full">
                <img
                  loading="lazy" decoding="async" src={imagePreview} alt="comic"
                  className="w-full h-full object-contain"
                  onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                {panels && natural && natural.w > 0 && natural.h > 0 && panels.map((p, i) => (
                  <div
                    key={i}
                    className="absolute border-2 grid place-items-start"
                    style={{
                      left: `${(p.x / natural.w) * 100}%`, top: `${(p.y / natural.h) * 100}%`,
                      width: `${(p.w / natural.w) * 100}%`, height: `${(p.h / natural.h) * 100}%`,
                      borderColor: BOX_COLORS[i % BOX_COLORS.length],
                      boxShadow: `inset 0 0 0 9999px ${BOX_COLORS[i % BOX_COLORS.length]}12`,
                    }}
                  >
                    <span className="text-[10px] font-mono font-bold px-1 rounded-br" style={{ background: BOX_COLORS[i % BOX_COLORS.length], color: '#000' }}>
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-[var(--soft)]">
                <Upload className="w-7 h-7 mx-auto mb-1 opacity-50" />
                <div className="text-xs">点击上传 或 用 URL</div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); if (fileRef.current) fileRef.current.value = ''; }} />
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs inline-flex items-center justify-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> 上传文件
            </button>
            <button onClick={() => setShowUrlInput(v => !v)} className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs inline-flex items-center justify-center gap-1.5">
              <LinkIcon className="w-3.5 h-3.5" /> 用 URL
            </button>
          </div>
          {showUrlInput && (
            <div className="flex gap-1">
              <input type="url" value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') acceptUrl(); }} placeholder="https://..."
                className="flex-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded focus:outline-none focus:border-[#E8C547]/50" />
              <button onClick={acceptUrl} disabled={!urlDraft.trim()} className="px-3 py-1 text-xs rounded bg-[#E8C547]/15 text-[#E8C547] hover:bg-[#E8C547]/25 disabled:opacity-40">抓取</button>
            </div>
          )}

          <button
            onClick={detect}
            disabled={detecting || !imageUrl}
            className="w-full px-4 py-2.5 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2"
          >
            {detecting ? (<><Loader2 className="w-4 h-4 animate-spin" /> 分格中…</>) : (<><Rows className="w-4 h-4" weight="bold" /> 自动分格</>)}
          </button>
        </div>

        {/* 结果区 */}
        <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5">
          <label className="text-xs text-[var(--soft)] uppercase tracking-wider">分格结果</label>
          {errorMsg ? (
            <div className="mt-3 text-center py-8">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
              <div className="text-sm text-rose-300 mb-1">分格失败</div>
              <div className="text-[11px] text-white/50">{errorMsg}</div>
            </div>
          ) : panels ? (
            <div className="mt-3">
              <div className="text-sm text-white font-medium mb-3">{summary}</div>
              {panels.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead>
                      <tr className="text-[var(--soft)] text-left border-b border-white/10">
                        <th className="py-1.5 pr-3 font-medium">格</th>
                        <th className="py-1.5 pr-3 font-medium">行/列</th>
                        <th className="py-1.5 pr-3 font-medium">x,y</th>
                        <th className="py-1.5 font-medium">宽×高</th>
                      </tr>
                    </thead>
                    <tbody>
                      {panels.map((p, i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0">
                          <td className="py-1.5 pr-3">
                            <span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: BOX_COLORS[i % BOX_COLORS.length] }} />
                            <span className="text-white align-middle">{i + 1}</span>
                          </td>
                          <td className="py-1.5 pr-3 text-[var(--muted)]">{p.row}/{p.col}</td>
                          <td className="py-1.5 pr-3 text-[var(--muted)]">{p.x},{p.y}</td>
                          <td className="py-1.5 text-[var(--muted)]">{p.w}×{p.h}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[13px] text-[var(--soft)] py-4">没检出格子。</div>
              )}
              {hint && <p className="text-[11px] text-amber-300/80 mt-3 leading-relaxed">⚠ {hint}</p>}
              <p className="text-[11px] text-[var(--soft)] mt-3 opacity-70 leading-relaxed">
                ✦ 下一步:每格裁图 → 单图变视频加动效 → 卡点拼接成动态漫剧(复用既有链路)。
              </p>
            </div>
          ) : (
            <div className="mt-3 text-center text-[var(--soft)] text-sm opacity-60 py-10">
              上传漫画后点「自动分格」——检出的格子会框在左图上,明细列在这里。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
