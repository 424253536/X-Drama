/**
 * 系列圣经(v12.266 · Phase 0 系列级资产)。
 *
 * ## 为什么要它
 *
 * 现状:系列各集角色资产在**第 1 集管线内**顺带生成、后续集继承 —— 第 1 集只读第 1 集剧本,
 * 不知道后面几十集谁是长期角色、有哪些常驻场景/关键道具;第 5 集才登场的男二没有任何锚。
 * 且 series_anchors.lockedCharacters 每集完成都被"本集前 3 个角色"覆盖,长系列群像剧必漂移。
 *
 * 本模块 = 生成前的 Phase 0:通读**全部集**剧本,LLM 产出「角色圣经(不限 3 个)+ 场景圣经 +
 * 关键道具圣经」,存 series_anchors.data.bible 作为跨集一致性的**唯一真源**;逐集生成时按
 * "本集出场谁"动态挑 ≤3 个注入(引擎参考图上限是硬约束:Minimax subject_reference≤3、Veo≤3)。
 *
 * 纯函数(prompt 构造/解析/净化/选角/合并)+ 一个 LLM 调用(extractSeriesBible),好测。
 */

import { callLLMWithFallback, stripThink } from '@/lib/llm-client';
import type { SanitizedLockedCharacter } from '@/lib/locked-characters';

// ── 数据结构 ────────────────────────────────────────────────────────────────

export type BibleRole = 'lead' | 'antagonist' | 'supporting' | 'cameo';

export interface SeriesBibleCharacter {
  name: string;
  role: BibleRole;
  /** 外貌/年龄/服饰等视觉设定(生成设定图的 prompt 源) */
  description: string;
  /** 别名/称呼(如"陆总/晚晚"),按集匹配出场用 */
  aliases?: string[];
  /** 设定图 URL(Phase 0 生成后回填;无图的角色不参与锁脸注入) */
  imageUrl?: string;
  /** cref 权重(25–125);缺省按 role 推 */
  cw?: number;
  /** 出场集号(LLM 提取,辅助按集选角) */
  episodes?: number[];
}

export interface SeriesBibleScene {
  /** 地点名(如"男主公寓") —— 会归一化后进 SceneAnchorRegistry */
  location: string;
  description: string;
  imageUrl?: string;
}

export interface SeriesBibleProp {
  name: string;
  description: string;
  imageUrl?: string;
  episodes?: number[];
}

export interface SeriesBible {
  characters: SeriesBibleCharacter[];
  scenes: SeriesBibleScene[];
  props: SeriesBibleProp[];
  /** 用户已确认(确认后生成侧才把它当真源;未确认也可用,但 UI 应引导确认) */
  confirmed?: boolean;
  generatedAt?: string;
}

/** 圣经容量上限(存储层,与注入层 ≤3 是两回事):角色 20 / 场景 12 / 道具 8。 */
export const BIBLE_MAX_CHARACTERS = 20;
export const BIBLE_MAX_SCENES = 12;
export const BIBLE_MAX_PROPS = 8;

const ROLES: BibleRole[] = ['lead', 'antagonist', 'supporting', 'cameo'];
/** 注入优先级:主角 > 反派 > 配角 > 客串。 */
const ROLE_PRIORITY: Record<BibleRole, number> = { lead: 3, antagonist: 2, supporting: 1, cameo: 0 };
/** 与 consistency-policy 同哲学:主角 cw 100,其余 80。 */
const ROLE_CW: Record<BibleRole, number> = { lead: 100, antagonist: 80, supporting: 80, cameo: 80 };

/**
 * 合法参考图 URL:http(s) 或站内持久化 /api/serve-file(persistAsset 的返回形状,
 * 现有 series_anchors 角色锚即此形状)。data:/javascript: 等一律拒。
 */
const isRefUrl = (u: unknown): u is string =>
  typeof u === 'string' && (/^https?:\/\//i.test(u) || u.startsWith('/api/serve-file'));

/** 与 consistency-policy.normalizeKey 同规则(小写+去标点空格);它不导出,此处内联同款,注释锚定。 */
export function normalizeLocationKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\s,.，。、:：;；!！?？\-—()（）\[\]【】<>《》"'""'']/g, '')
    .trim();
}

// ── 净化(白名单,与 locked-characters 同哲学:外部 JSON 一律不信) ────────────

function cleanStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function cleanEpisodes(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n >= 1 && n <= 500);
  return out.length ? Array.from(new Set(out)).sort((a, b) => a - b).slice(0, 200) : undefined;
}

export function sanitizeSeriesBible(raw: unknown): SeriesBible {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const characters: SeriesBibleCharacter[] = (Array.isArray(r.characters) ? r.characters : [])
    .map((c: any): SeriesBibleCharacter | null => {
      const name = cleanStr(c?.name, 40);
      if (!name) return null;
      const role: BibleRole = ROLES.includes(c?.role) ? c.role : 'supporting';
      const aliases = Array.isArray(c?.aliases)
        ? c.aliases.map((a: unknown) => cleanStr(a, 20)).filter(Boolean).slice(0, 6)
        : undefined;
      return {
        name,
        role,
        description: cleanStr(c?.description, 300),
        ...(aliases?.length ? { aliases } : {}),
        ...(isRefUrl(c?.imageUrl) ? { imageUrl: c.imageUrl } : {}),
        ...(Number.isFinite(c?.cw) ? { cw: Math.max(25, Math.min(125, Math.round(c.cw))) } : {}),
        ...(cleanEpisodes(c?.episodes) ? { episodes: cleanEpisodes(c?.episodes) } : {}),
      };
    })
    .filter((c): c is SeriesBibleCharacter => !!c)
    .slice(0, BIBLE_MAX_CHARACTERS);

  const scenes: SeriesBibleScene[] = (Array.isArray(r.scenes) ? r.scenes : [])
    .map((s: any): SeriesBibleScene | null => {
      const location = cleanStr(s?.location ?? s?.name, 40);
      if (!location) return null;
      return {
        location,
        description: cleanStr(s?.description, 200),
        ...(isRefUrl(s?.imageUrl) ? { imageUrl: s.imageUrl } : {}),
      };
    })
    .filter((s): s is SeriesBibleScene => !!s)
    .slice(0, BIBLE_MAX_SCENES);

  const props: SeriesBibleProp[] = (Array.isArray(r.props) ? r.props : [])
    .map((p: any): SeriesBibleProp | null => {
      const name = cleanStr(p?.name, 40);
      if (!name) return null;
      return {
        name,
        description: cleanStr(p?.description, 200),
        ...(isRefUrl(p?.imageUrl) ? { imageUrl: p.imageUrl } : {}),
        ...(cleanEpisodes(p?.episodes) ? { episodes: cleanEpisodes(p?.episodes) } : {}),
      };
    })
    .filter((p): p is SeriesBibleProp => !!p)
    .slice(0, BIBLE_MAX_PROPS);

  return {
    characters,
    scenes,
    props,
    ...(r.confirmed === true ? { confirmed: true } : {}),
    ...(typeof r.generatedAt === 'string' ? { generatedAt: r.generatedAt } : {}),
  };
}

// ── LLM 提取(Phase 0:通读全部集) ──────────────────────────────────────────

export interface BibleEpisodeInput {
  episodeNumber: number;
  text: string;
}

/** 单集喂给提取 LLM 的字数上限 / 全剧总上限(token 预算;提取只需要"谁反复出现",不需要全文)。 */
export const BIBLE_PER_EP_CAP = 1500;
export const BIBLE_TOTAL_CAP = 24000;

export function buildBibleSystemPrompt(): string {
  return [
    '你是资深短剧制片统筹。通读整部剧的分集剧本,提炼出保证跨集视觉一致性所需的「系列圣经」。',
    '要求:',
    '① characters:所有**跨集反复出现**的长期角色(主角/反派/常驻配角),单集路人不收;',
    '   每个角色给 name、role(lead/antagonist/supporting/cameo)、description(外貌+年龄段+标志服饰,80字内,用于生成角色设定图)、aliases(剧中别称)、episodes(出场集号数组);',
    '② scenes:**多集重复使用**的固定场景(如主角公寓/公司大堂),给 location、description(空间+光线+氛围,60字内);',
    '③ props:**跨集反复出现且剧情关键**的道具(信物/合同/玉佩等),给 name、description(材质+外观,60字内)、episodes;单场闲杂物件不收;',
    '④ 只输出 JSON,不要任何解释。',
    '输出格式:{"characters":[...],"scenes":[...],"props":[...]}',
  ].join('\n');
}

export function buildBibleUserPrompt(episodes: BibleEpisodeInput[]): string {
  const parts: string[] = [];
  let used = 0;
  for (const ep of episodes) {
    const body = (ep.text || '').replace(/\s+/g, ' ').trim().slice(0, BIBLE_PER_EP_CAP);
    if (!body) continue;
    const line = `第${ep.episodeNumber}集:${body}`;
    if (used + line.length > BIBLE_TOTAL_CAP) break;
    parts.push(line);
    used += line.length + 1;
  }
  return `全剧共 ${episodes.length} 集,分集剧情如下:\n${parts.join('\n')}\n\n请提炼系列圣经。`;
}

function stripFences(s: string): string {
  return s.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
}

/** 解析 LLM 输出 → SeriesBible。容错剥 think/fence + 中文键名;解析失败 → null。纯函数。 */
export function parseSeriesBible(content: string): SeriesBible | null {
  if (!content) return null;
  let obj: any = null;
  try { obj = JSON.parse(stripFences(stripThink(content))); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const bible = sanitizeSeriesBible({
    characters: obj.characters ?? obj.角色 ?? [],
    scenes: obj.scenes ?? obj.场景 ?? [],
    props: obj.props ?? obj.道具 ?? [],
  });
  return bible.characters.length || bible.scenes.length || bible.props.length ? bible : null;
}

/** 通读全部集 → 系列圣经(LLM,jsonMode)。失败抛错(调用方决定降级)。 */
export async function extractSeriesBible(episodes: BibleEpisodeInput[]): Promise<SeriesBible> {
  const res = await callLLMWithFallback({
    system: buildBibleSystemPrompt(),
    user: buildBibleUserPrompt(episodes),
    jsonMode: true,
    maxTokens: 3000,
    temperature: 0.3, // 提取任务,要稳不要发散
  });
  if (!res.ok || !res.content) throw new Error('圣经提取失败:' + (res.error || 'LLM 无返回'));
  const bible = parseSeriesBible(res.content);
  if (!bible) throw new Error('圣经提取失败:未解析出有效内容');
  return { ...bible, generatedAt: new Date().toISOString() };
}

// ── 按集动态选角(注入层 ≤3:引擎参考图硬上限) ──────────────────────────────

/** 归一文本用于出场匹配(与 location 归一同款)。 */
const normText = normalizeLocationKey;

/**
 * 从圣经里挑「本集出场」的 ≤max 个已有设定图的角色,转 lockedCharacters 形状。
 * 判据(命中任一即算出场):① 集号在 episodes 里;② name/alias 出现在本集剧情文本里。
 * 无法判定出场(文本太短且无集号)时兜底取 lead 优先的前 max 个 —— 主角永不缺锚。
 * 排序:出场命中 > role 优先级(lead>antagonist>supporting>cameo)> 圣经原序。纯函数。
 */
export function pickEpisodeCharacters(
  bible: SeriesBible | null | undefined,
  episodeText: string,
  episodeNumber: number | null,
  max = 3,
): SanitizedLockedCharacter[] {
  const candidates = (bible?.characters || []).filter((c) => isRefUrl(c.imageUrl));
  if (candidates.length === 0) return [];
  const text = normText(episodeText || '');

  const scored = candidates.map((c, i) => {
    const byEpisode = typeof episodeNumber === 'number' && (c.episodes || []).includes(episodeNumber);
    const names = [c.name, ...(c.aliases || [])].map(normText).filter((n) => n.length >= 2);
    const byText = !!text && names.some((n) => text.includes(n));
    return { c, i, present: byEpisode || byText ? 1 : 0 };
  });

  const anyPresent = scored.some((s) => s.present);
  const pool = anyPresent ? scored.filter((s) => s.present) : scored; // 全都判不出 → 兜底全量按优先级
  pool.sort((a, b) => (ROLE_PRIORITY[b.c.role] - ROLE_PRIORITY[a.c.role]) || (a.i - b.i));

  return pool.slice(0, Math.max(1, max)).map(({ c }) => ({
    name: c.name,
    role: c.role,
    cw: c.cw ?? ROLE_CW[c.role],
    imageUrl: c.imageUrl as string,
  }));
}

// ── 场景/道具 → 跨集传播形状 ────────────────────────────────────────────────

export interface SceneAnchorEntry {
  location: string;
  description?: string;
  url: string;
}

/** 圣经场景(有图的)→ SceneAnchorRegistry.seed 可食的条目(location 必须先归一,seed 不再归一)。 */
export function bibleSceneAnchorEntries(bible: SeriesBible | null | undefined): SceneAnchorEntry[] {
  return (bible?.scenes || [])
    .filter((s) => isRefUrl(s.imageUrl))
    .map((s) => ({ location: normalizeLocationKey(s.location), description: s.description, url: s.imageUrl as string }))
    .filter((s) => s.location);
}

/** 圣经道具设定图(有图的)→ 构图参考 URL 列表(走 setSceneReferences 低优先通道)。已按 isRefUrl 校验。 */
export function biblePropRefs(bible: SeriesBible | null | undefined): string[] {
  return (bible?.props || []).map((p) => p.imageUrl).filter(isRefUrl);
}

/** 场景锚合并:按归一 location 去重,**先到的保留**(最早集是基线,防后覆盖前漂移)。上限 30。 */
export function mergeSceneAnchorEntries(
  prev: SceneAnchorEntry[] | undefined,
  incoming: SceneAnchorEntry[] | undefined,
): SceneAnchorEntry[] {
  const out: SceneAnchorEntry[] = [];
  const seen = new Set<string>();
  for (const e of [...(prev || []), ...(incoming || [])]) {
    const loc = normalizeLocationKey(e?.location || '');
    if (!loc || !isRefUrl(e?.url) || seen.has(loc)) continue;
    seen.add(loc);
    out.push({ location: loc, description: e.description, url: e.url });
    if (out.length >= 30) break;
  }
  return out;
}

// ── 每集完成后的锚点合并(取代"本集角色直接覆盖锚点"的旧逻辑) ─────────────────

export interface SeriesAnchorLike {
  lockedCharacters?: Array<{ name: string; imageUrl: string; role?: string; cw?: number }>;
  styleAnchorUrl?: string;
  lastEpisodeEndFrame?: string;
  fromEpisode?: number;
  bible?: SeriesBible;
  sceneAnchors?: SceneAnchorEntry[];
}

/**
 * 本集收尾时合并系列锚点(纯函数):
 * - 有圣经 → lockedCharacters **不被本集覆盖**(圣经是真源,防长系列群像漂移);
 *   无圣经 → 维持旧语义(本集角色 > 上集沉淀)。
 * - sceneAnchors:并入本集新登记的场景锚(先到基线优先)。
 * - styleAnchorUrl:本集有值则更新;bible/末帧原样保留。
 */
export function mergeSeriesAnchorOnEpisodeDone(
  prev: SeriesAnchorLike | null | undefined,
  ep: {
    characters: Array<{ name: string; imageUrl: string; role?: string; cw?: number }>;
    styleAnchorUrl?: string;
    episodeNumber?: number | null;
    sceneEntries?: SceneAnchorEntry[];
  },
): SeriesAnchorLike {
  const p = prev || {};
  const hasBible = !!(p.bible && p.bible.characters.length);
  return {
    ...p,
    lockedCharacters: hasBible
      ? p.lockedCharacters
      : (ep.characters.length ? ep.characters : p.lockedCharacters),
    styleAnchorUrl: ep.styleAnchorUrl || p.styleAnchorUrl,
    sceneAnchors: mergeSceneAnchorEntries(p.sceneAnchors, ep.sceneEntries),
    fromEpisode: typeof ep.episodeNumber === 'number' ? ep.episodeNumber : p.fromEpisode,
  };
}
