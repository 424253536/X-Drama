'use client';

/**
 * /dashboard/mv · MV 卡点规划台(v12.250 前端入口 → v12.246 /api/mv/plan)
 *
 * MV 模式的前端入口:给音乐时长 + BPM(+ 可选段落),后端算出**卡点镜头时间轴**
 * (每镜起止落在拍上、副歌加密、末镜贴合结尾)。本页把时间轴可视化成一条卡点色带 + 明细表。
 *
 * 诚实边界:本页只出**镜头规划**(切点),每镜配画面 → 卡点合成成片复用既有
 * generateImage / u2v / video-composer,是下一步(页内如实标注)。
 */

import { useState } from 'react';
import { MusicNotes, Sparkle as Sparkles, Waveform, Warning as AlertTriangle, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useToast } from '@/components/ui/toast-provider';

interface MvShot {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  section: string;
  onBeat: boolean;
}

// 段落配色 —— 副歌最亮(金),主歌次之,过渡/首尾偏冷,和「副歌加密」的语义呼应。
const SECTION_COLOR: Record<string, string> = {
  chorus: '#E8C547',
  verse: '#4A7EBB',
  bridge: '#9B6DC4',
  intro: '#3F8F7A',
  outro: '#8A6D3B',
  unknown: '#555',
};
const SECTION_LABEL: Record<string, string> = {
  chorus: '副歌', verse: '主歌', bridge: '过渡', intro: '前奏', outro: '尾奏', unknown: '—',
};

export default function MvPlanPage() {
  const [durationSec, setDurationSec] = useState(60);
  const [bpm, setBpm] = useState(120);
  const [beatsPerShot, setBeatsPerShot] = useState(8);
  const [planning, setPlanning] = useState(false);
  const [shots, setShots] = useState<MvShot[] | null>(null);
  const [summary, setSummary] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const { showToast } = useToast();

  const plan = async () => {
    setPlanning(true);
    setErrorMsg('');
    setShots(null);
    try {
      const res = await fetch('/api/mv/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ musicDurationSec: durationSec, bpm, beatsPerShot }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.message || `规划失败 (HTTP ${res.status})`;
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setShots(body.shots || []);
      setSummary(body.summary || '');
      showToast({ title: `已规划 ${body.shotCount} 个卡点镜头`, type: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,规划失败';
      setErrorMsg(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setPlanning(false);
    }
  };

  const total = shots && shots.length ? shots[shots.length - 1].endSec : durationSec;

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MusicNotes className="w-6 h-6 text-[#E8C547]" weight="duotone" />
          MV 卡点规划台
        </h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          给音乐时长 + BPM,AI 算出每镜落在拍上的**卡点时间轴**(副歌自动加密、末镜贴合结尾)。
          规划完成后,每镜配画面 → 卡点合成复用既有出片链路(下一步)。
        </p>
      </div>

      {/* 输入区 */}
      <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">音乐时长(秒)</label>
            <input
              type="number" min={1} max={600} value={durationSec}
              onChange={e => setDurationSec(Number(e.target.value))}
              className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">BPM(每分钟拍数)</label>
            <input
              type="number" min={1} max={400} value={bpm}
              onChange={e => setBpm(Number(e.target.value))}
              className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">每镜拍数</label>
            <input
              type="number" min={1} max={64} value={beatsPerShot}
              onChange={e => setBeatsPerShot(Number(e.target.value))}
              className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm tabular-nums"
            />
            <div className="text-[10px] text-[var(--soft)] mt-1 opacity-60">越小切得越碎;副歌会自动减半加密</div>
          </div>
        </div>

        <button
          onClick={plan}
          disabled={planning || !(durationSec > 0) || !(bpm > 0) || !(beatsPerShot > 0)}
          className="w-full px-4 py-2.5 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2"
        >
          {planning ? (<><Loader2 className="w-4 h-4 animate-spin" /> 规划中…</>) : (<><Waveform className="w-4 h-4" weight="bold" /> 生成卡点时间轴</>)}
        </button>
      </div>

      {/* 结果区 */}
      <div className="mt-5">
        {errorMsg ? (
          <div className="bg-[rgba(255,255,255,0.04)] border border-rose-500/20 rounded-2xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
            <div className="text-sm text-rose-300 mb-1">规划失败</div>
            <div className="text-[11px] text-white/50">{errorMsg}</div>
          </div>
        ) : shots && shots.length === 0 ? (
          // 规划成功但零镜头(如节拍太快):要和「还没点」区分,并把 summary 显出来,别让结果静默消失。
          <div className="bg-[rgba(255,255,255,0.04)] border border-[var(--border)] rounded-2xl p-6 text-center">
            <div className="text-sm text-[var(--muted)] mb-1">{summary || '没有可规划的卡点镜头'}</div>
            <div className="text-[11px] text-[var(--soft)]">试试调低 BPM 或每镜拍数、或加长音乐时长。</div>
          </div>
        ) : shots && shots.length > 0 ? (
          <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[#E8C547]" weight="duotone" />
              <span className="text-sm text-white font-medium">{summary}</span>
            </div>

            {/* 卡点色带:每镜按时长占比着色,段落配色 */}
            <div className="flex w-full h-9 rounded-lg overflow-hidden border border-white/10 mb-2" role="img" aria-label="卡点镜头时间轴">
              {shots.map((s) => (
                <div
                  key={s.index}
                  title={`第${s.index}镜 · ${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}s · ${SECTION_LABEL[s.section] || s.section}`}
                  style={{ width: `${(s.durationSec / total) * 100}%`, background: SECTION_COLOR[s.section] || SECTION_COLOR.unknown }}
                  className="h-full border-r border-black/30 last:border-r-0 grid place-items-center text-[9px] font-mono text-black/70 overflow-hidden"
                >
                  {(s.durationSec / total) > 0.05 ? s.index : ''}
                </div>
              ))}
            </div>
            {/* 段落图例 */}
            <div className="flex flex-wrap gap-3 mb-4 text-[10px] text-[var(--soft)]">
              {Array.from(new Set(shots.map(s => s.section))).map(sec => (
                <span key={sec} className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SECTION_COLOR[sec] || SECTION_COLOR.unknown }} />
                  {SECTION_LABEL[sec] || sec}
                </span>
              ))}
            </div>

            {/* 明细表 */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--soft)] text-left border-b border-white/10">
                    <th className="py-1.5 pr-3 font-medium">镜</th>
                    <th className="py-1.5 pr-3 font-medium">起(s)</th>
                    <th className="py-1.5 pr-3 font-medium">止(s)</th>
                    <th className="py-1.5 pr-3 font-medium">时长(s)</th>
                    <th className="py-1.5 pr-3 font-medium">段落</th>
                    <th className="py-1.5 font-medium">对齐拍</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {shots.map((s) => (
                    <tr key={s.index} className="border-b border-white/5 last:border-0">
                      <td className="py-1.5 pr-3 text-white">{s.index}</td>
                      <td className="py-1.5 pr-3 text-[var(--muted)]">{s.startSec.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-[var(--muted)]">{s.endSec.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-[var(--muted)]">{s.durationSec.toFixed(2)}</td>
                      <td className="py-1.5 pr-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-sm" style={{ background: SECTION_COLOR[s.section] || SECTION_COLOR.unknown }} />
                          {SECTION_LABEL[s.section] || s.section}
                        </span>
                      </td>
                      <td className="py-1.5 text-emerald-400">{s.onBeat ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-[var(--soft)] mt-4 opacity-70 leading-relaxed">
              ✦ 下一步:为每镜配画面(既有 generateImage / 单图变视频)→ 按此时间轴卡点拼接(既有 video-composer)。
              本页是规划骨架,出片链路接线跟进。
            </p>
          </div>
        ) : (
          <div className="text-center text-[var(--soft)] text-sm opacity-60 py-10">
            填时长与 BPM,点「生成卡点时间轴」——结果会出现在这里。
          </div>
        )}
      </div>
    </div>
  );
}
