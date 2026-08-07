/**
 * lib/edl-export (v8.0) — EDL / FCP7 XML 导出 (对接 DaVinci Resolve / Premiere Pro)
 *
 * 纯逻辑, 把分镜序列 (顺序拼接的镜头) 编译成专业 NLE 可导入的剪辑表:
 *   - buildEDL():    CMX3600 EDL (最通用, DaVinci/Premiere/Avid 都能读)
 *   - buildFCPXML(): FCP7 xmeml (DaVinci / Premiere 导入, 保留片段名 + 时长)
 *
 * 注: EDL + FCPXML 覆盖 DaVinci/Premiere 对接 (最通用)。真 AAF (Avid) 为二进制 MS-CFB 容器,
 *     已在 v9.2.0 由 lib/aaf-export 自实现 (无第三方库), 端点 /api/projects/[id]/export-aaf。
 */

export interface EdlShot {
  name: string;
  /** ⚠️ 必须是**成片终值时长**,不是剧本设计时长 —— 见文件头 v12.277 说明。 */
  durationS: number;
  sourceUrl?: string;
  /** v12.277:该镜**进入时**的转场('cut' 视为硬切,其余按溶解处理)。 */
  transition?: string;
  /** v12.277:转场时长(秒)。EDL 的 D 事件与 FCPXML 的 transitionitem 都需要它。 */
  transitionDurationS?: number;
}

/** v12.277:音轨条目(逐镜配音 / 整条 BGM)。 */
export interface EdlAudio {
  name: string;
  sourceUrl?: string;
  /** 在成片时间轴上的起点(秒) */
  startS: number;
  durationS: number;
  /** 'vo' 逐镜配音 → A1;'bgm' 配乐 → A2 */
  kind: 'vo' | 'bgm';
}

const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** 帧数 → CMX 时间码 HH:MM:SS:FF (non-drop) */
export function framesToTimecode(frames: number, fps = 24): string {
  const f = Math.max(0, Math.round(frames));
  const ff = f % fps;
  const totalSec = Math.floor(f / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

export function secondsToTimecode(seconds: number, fps = 24): string {
  return framesToTimecode(Math.round((seconds || 0) * fps), fps);
}

/** 归一化镜头: 时长兜底 5s, 名称兜底 */
function normShots(shots: EdlShot[]): { name: string; durationS: number; sourceUrl?: string; transition?: string; transitionDurationS?: number }[] {
  return (Array.isArray(shots) ? shots : []).map((s, i) => ({
    name: (s?.name || `Shot ${i + 1}`).slice(0, 80),
    // ⚠️ v12.277 修既有精度 bug:此前这里是 `Math.round(durationS)` —— 把**秒**四舍五入成整秒,
    // 之后才 × fps,亚秒精度被直接抹掉(3.5s 导成 4s)。而变速后的时长几乎全是小数
    // (如 4 ÷ 0.7 = 5.71s),20 个镜头累积可漂十几秒 —— 剪辑线「看着像、对不上」的另一个根因。
    // 现在保留原始秒值,由调用方按 `Math.round(durationS * fps)` 一次性转帧。
    durationS: (s?.durationS && s.durationS > 0) ? s.durationS : 5,
    sourceUrl: s?.sourceUrl,
    transition: s?.transition,
    transitionDurationS: s?.transitionDurationS,
  }));
}

/** 秒 → 帧(唯一转换口径,避免各处各转一次导致累积误差)。 */
function toFrames(durationS: number, fps: number): number {
  return Math.max(1, Math.round((durationS || 0) * fps));
}

/** v12.277:非硬切即按溶解导出。'cut'/'flash-cut' 与空值都算硬切。 */
export function isDissolveTransition(t: string | undefined | null): boolean {
  const v = String(t || '').trim().toLowerCase();
  if (!v) return false;
  return v !== 'cut' && v !== 'flash-cut' && v !== 'continuous';
}

/** CMX3600 EDL */
export function buildEDL(shots: EdlShot[], fps = 24, title = 'WIND COMIC TIMELINE', audio: EdlAudio[] = []): string {
  const norm = normShots(shots).map((s) => ({ ...s, frames: toFrames(s.durationS, fps) }));
  const lines: string[] = [`TITLE: ${title}`, 'FCM: NON-DROP FRAME', ''];
  let rec = 0;
  let evtNo = 0;
  const nextEvt = () => String(++evtNo).padStart(3, '0');

  norm.forEach((s) => {
    const srcIn = framesToTimecode(0, fps);
    const srcOut = framesToTimecode(s.frames, fps);
    const recIn = framesToTimecode(rec, fps);
    const recOut = framesToTimecode(rec + s.frames, fps);
    // v12.277:非硬切导出为 D(溶解)事件 —— 此前一律写 C,管线设计的转场在剪辑线里全丢了。
    // CMX3600 惯例:D 事件需前置一条同 record-in 的 C 事件作为 "from" 素材,并在 D 行末给出转场帧数。
    if (isDissolveTransition(s.transition)) {
      const tFrames = Math.max(1, Math.round((s.transitionDurationS ?? 0.5) * fps));
      lines.push(`${nextEvt()}  AX       V     C        ${srcOut} ${srcOut} ${recIn} ${recIn}`);
      lines.push(`${nextEvt()}  AX       V     D    ${String(tFrames).padStart(3, '0')} ${srcIn} ${srcOut} ${recIn} ${recOut}`);
      lines.push(`* EFFECT NAME: CROSS DISSOLVE`);
    } else {
      lines.push(`${nextEvt()}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    }
    lines.push(`* FROM CLIP NAME: ${s.name}`);
    if (s.sourceUrl) lines.push(`* SOURCE FILE: ${s.sourceUrl}`);
    lines.push('');
    rec += s.frames;
  });

  // v12.277:音轨 —— 逐镜配音走 A(A1 语义),BGM 走 A2。
  // 此前 EDL 只有 V 轨,剪辑师导入后**逐角色配音与配乐全部丢失**,等于把管线一半的活儿扔了。
  for (const a of Array.isArray(audio) ? audio : []) {
    const dur = Math.max(1, Math.round((a?.durationS > 0 ? a.durationS : 1) * fps));
    const start = Math.max(0, Math.round((a?.startS || 0) * fps));
    const chan = a?.kind === 'bgm' ? 'A2   ' : 'A    ';
    lines.push(`${nextEvt()}  AX       ${chan} C        ${framesToTimecode(0, fps)} ${framesToTimecode(dur, fps)} ${framesToTimecode(start, fps)} ${framesToTimecode(start + dur, fps)}`);
    lines.push(`* FROM CLIP NAME: ${a.name}`);
    if (a.sourceUrl) lines.push(`* SOURCE FILE: ${a.sourceUrl}`);
    lines.push('');
  }
  return lines.join('\n');
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

/** FCP7 XML (xmeml v5) — DaVinci / Premiere 可导入 */
export function buildFCPXML(shots: EdlShot[], fps = 24, title = 'Wind Comic Sequence', audio: EdlAudio[] = []): string {
  const norm = normShots(shots).map((s) => ({ ...s, frames: toFrames(s.durationS, fps) }));
  const total = norm.reduce((a, s) => a + s.frames, 0);
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  let rec = 0;
  const clips = norm.map((s, i) => {
    const start = rec, end = rec + s.frames; rec = end;
    return [
      `        <clipitem id="clipitem-${i + 1}">`,
      `          <name>${xmlEscape(s.name)}</name>`,
      `          <duration>${s.frames}</duration>`,
      `          ${rate}`,
      `          <start>${start}</start>`,
      `          <end>${end}</end>`,
      `          <in>0</in>`,
      `          <out>${s.frames}</out>`,
      s.sourceUrl ? `          <pathurl>${xmlEscape(s.sourceUrl)}</pathurl>` : '',
      `        </clipitem>`,
    ].filter(Boolean).join('\n');
  });
  // v12.277:按 kind 分两条音轨(vo → A1,bgm → A2)
  const mkAudioTrack = (items: EdlAudio[], label: string): string[] => {
    if (!items.length) return [];
    const cis = items.map((a, i) => {
      const dur = Math.max(1, Math.round((a?.durationS > 0 ? a.durationS : 1) * fps));
      const start = Math.max(0, Math.round((a?.startS || 0) * fps));
      return [
        `          <clipitem id="${label}-${i + 1}">`,
        `            <name>${xmlEscape(a.name)}</name>`,
        `            <duration>${dur}</duration>`,
        `            ${rate}`,
        `            <start>${start}</start>`,
        `            <end>${start + dur}</end>`,
        `            <in>0</in>`,
        `            <out>${dur}</out>`,
        a.sourceUrl ? `            <pathurl>${xmlEscape(a.sourceUrl)}</pathurl>` : '',
        `          </clipitem>`,
      ].filter(Boolean).join('\n');
    });
    return ['        <track>', ...cis, '        </track>'];
  };
  const list = Array.isArray(audio) ? audio : [];
  const audioTracks = [
    ...mkAudioTrack(list.filter((a) => a?.kind !== 'bgm'), 'vo'),
    ...mkAudioTrack(list.filter((a) => a?.kind === 'bgm'), 'bgm'),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="5">',
    `  <sequence id="sequence-1">`,
    `    <name>${xmlEscape(title)}</name>`,
    `    <duration>${total}</duration>`,
    `    ${rate}`,
    '    <media>',
    '      <video>',
    '        <track>',
    ...clips,
    '        </track>',
    '      </video>',
    // v12.277:音频段 —— 此前 FCPXML 只有 <video>,配音/配乐进不了剪辑线。
    // A1 = 逐镜配音,A2 = BGM;各自独立 track,便于剪辑师单独调平衡。
    ...(audioTracks.length ? ['      <audio>', ...audioTracks, '      </audio>'] : []),
    '    </media>',
    '  </sequence>',
    '</xmeml>',
  ].join('\n');
}
