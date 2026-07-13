'use client';

/**
 * v9.7.7 — 角色音色货架(阶段十六 · 音色手动覆盖)。列出全片角色 + 当前音色(覆盖 / 自动),
 * 下拉挑 `VOICE_CATALOG` 音色 + 「试听」(POST /api/voice-sample)+ 「保存」(POST /voice-overrides)。
 * 保存后 shot-audio 优先用覆盖音色。挂在「配音口型」面板内,默认折叠。
 */
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { UserSound, CaretDown, CaretRight, Play, CircleNotch, FloppyDisk, UploadSimple } from '@phosphor-icons/react';
import { VOICE_CATALOG } from '@/lib/character-studio';
import { buildVoiceRouting } from '@/lib/voice-routing';

export function VoiceShelf({ projectId, characters }: { projectId: string; characters: string[] }) {
  const distinct = useMemo(() => Array.from(new Set(characters.map((c) => (c || '').trim()).filter(Boolean))), [characters]);
  const autoRouting = useMemo(() => buildVoiceRouting(distinct), [distinct]);
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [auditionId, setAuditionId] = useState<string | null>(null);
  // v12.208:音色克隆 —— 上传音样 → MiniMax 克隆 → voiceId 进音色列表可绑定角色
  const [cloned, setCloned] = useState<Array<{ id: string; label: string }>>([]);
  const [cloneName, setCloneName] = useState('');
  const [cloning, setCloning] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const doClone = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setSavedMsg('请先选择音样文件(WAV/MP3,≥10s、≤5MB)'); return; }
    if (file.size > 5 * 1024 * 1024) { setSavedMsg('音样需 ≤5MB'); return; }
    setCloning(true); setSavedMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (cloneName.trim()) fd.append('name', cloneName.trim());
      const res = await fetch('/api/voice-clone', { method: 'POST', body: fd });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || '克隆失败');
      setCloned((arr) => [...arr, { id: b.voiceId, label: `${cloneName.trim() || b.voiceId} [克隆]` }]);
      setSavedMsg(`✓ 克隆成功:${b.voiceId} —— 已加入下拉,选给角色后保存即生效`);
      if (fileRef.current) fileRef.current.value = '';
      setCloneName('');
    } catch (e) { setSavedMsg(e instanceof Error ? e.message : '克隆失败'); }
    finally { setCloning(false); }
  }, [cloneName]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-overrides`);
        const b = await res.json();
        if (alive && res.ok && b.overrides) setOverrides(b.overrides);
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const voiceFor = useCallback((c: string) => overrides[c] || autoRouting.get(c) || 'narrator_male_cn', [overrides, autoRouting]);

  const audition = useCallback(async (c: string) => {
    setAuditionId(c); setSavedMsg(null);
    try {
      const res = await fetch('/api/voice-sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voiceId: voiceFor(c) }) });
      const b = await res.json();
      if (b.ok && b.audioUrl) { try { await new Audio(b.audioUrl).play(); } catch { /* 自动播放被拦 */ } }
      else setSavedMsg(b.message || '试听失败(需 TTS 引擎)');
    } catch (e) { setSavedMsg(e instanceof Error ? e.message : '试听失败'); }
    finally { setAuditionId(null); }
  }, [voiceFor]);

  const save = useCallback(async () => {
    setSaving(true); setSavedMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-overrides`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides }),
      });
      const b = await res.json();
      setSavedMsg(b.ok ? '已保存 —— 下次「合成配音」按此音色' : (b.message || '保存失败'));
    } catch (e) { setSavedMsg(e instanceof Error ? e.message : '保存失败'); }
    finally { setSaving(false); }
  }, [projectId, overrides]);

  if (!distinct.length) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 mb-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-1.5 text-[11px] text-white/70">
        {open ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
        <UserSound className="w-3.5 h-3.5" /> 角色音色 · {distinct.length} 角色（手动挑 / 试听,覆盖自动路由）
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {distinct.map((c) => {
            const cur = voiceFor(c);
            const overridden = !!overrides[c];
            return (
              <div key={c} className="flex items-center gap-2">
                <span className="text-[11px] text-white/70 w-20 shrink-0 truncate">{c}</span>
                <select
                  value={cur}
                  onChange={(e) => setOverrides((m) => ({ ...m, [c]: e.target.value }))}
                  className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded px-1.5 py-1 text-[11px] text-white/80 outline-none"
                >
                  {VOICE_CATALOG.map((v) => (<option key={v.id} value={v.id} className="bg-[#1a1a24]">{v.label} · {v.tone}</option>))}
                  {cloned.map((v) => (<option key={v.id} value={v.id} className="bg-[#1a1a24]">{v.label}</option>))}
                </select>
                <span className={`text-[9px] shrink-0 w-6 ${overridden ? 'text-amber-300/70' : 'text-white/25'}`}>{overridden ? '手动' : '自动'}</span>
                <button onClick={() => audition(c)} disabled={!!auditionId} className="cinema-btn !px-1.5 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50" title="试听">
                  {auditionId === c ? <CircleNotch className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                </button>
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className="cinema-btn cinema-btn-primary !px-2.5 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50">
              {saving ? <CircleNotch className="w-3 h-3 animate-spin" /> : <FloppyDisk className="w-3 h-3" />}
              {saving ? '保存中…' : '保存音色'}
            </button>
            {savedMsg && <span className="text-[10px] text-white/45 truncate">{savedMsg}</span>}
          </div>

          {/* v12.208:音色克隆 —— 上传音样(≥10s 干净人声)克隆专属音色,voiceId 进上方下拉可绑定角色 */}
          <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
            <div className="text-[10px] text-white/45">🎤 克隆专属音色(上传 ≥10s 干净人声,WAV/MP3 ≤5MB)</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <input ref={fileRef} type="file" accept="audio/*" className="text-[10px] text-white/60 max-w-[150px]" />
              <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="音色名(如 老陈)"
                className="bg-white/[0.04] border border-white/10 rounded px-1.5 py-1 text-[11px] text-white/80 outline-none w-[100px]" />
              <button onClick={doClone} disabled={cloning} className="cinema-btn !px-2 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50">
                {cloning ? <CircleNotch className="w-3 h-3 animate-spin" /> : <UploadSimple className="w-3 h-3" />}
                {cloning ? '克隆中…(约10-30s)' : '克隆音色'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
