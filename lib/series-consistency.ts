/**
 * lib/series-consistency (v12.266) —— 跨集一致性质检(纯函数层)。
 *
 * 现有 drift-detect/face_score/style-audit 全是**集内**(单项目跨镜头);本模块补上跨集维度:
 * 「第 N 集生成的角色图,和系列圣经里该角色的设定图,还是同一个人吗?」
 *
 * 判法:圣经角色设定图 embedding 为基准,各集同名角色资产图 embedding 算余弦相似,
 * 低于阈值标 suspect。定位是**报告不阻断**(图像相似度误报率撑不起硬门禁),
 * 供用户挑出疑似漂移的集重生成。embedding 不可用 → available:false 诚实降级(与 drift-detect 同哲学)。
 *
 * 纯函数、零 IO、可单测;embedding 获取在 API 路由层。
 */
import { cosineSimilarity } from './asset-embedding';

/** 与 asset-embedding.normText 同款归一(名字匹配用)。 */
const norm = (s: string) =>
  (s || '').toLowerCase().replace(/[\s,.，。、:：;；!！?？\-—()（）\[\]【】<>《》「」『』"'""'']/g, '').trim();

/** 资产名 → 圣经角色名匹配(精确 > 双向子串,≥2 字才算)。返回命中的圣经名;无 → null。 */
export function matchBibleCharacterName(bibleNames: string[], assetName: string): string | null {
  const a = norm(assetName);
  if (a.length < 2) return null;
  for (const b of bibleNames) {
    const n = norm(b);
    if (n && n === a) return b;
  }
  for (const b of bibleNames) {
    const n = norm(b);
    if (n.length >= 2 && (a.includes(n) || n.includes(a))) return b;
  }
  return null;
}

export interface RefEmbedding {
  name: string;
  vector: number[];
}

export interface EpisodeCharEmbedding {
  episodeNumber: number;
  name: string; // 已匹配到的圣经角色名
  vector: number[];
}

export interface ConsistencyFinding {
  episodeNumber: number;
  name: string;
  /** 与圣经设定图的余弦相似(0–1,越低越漂) */
  similarity: number;
  suspect: boolean;
}

export interface SeriesConsistencyResult {
  findings: ConsistencyFinding[]; // 按相似度升序(最可疑在前)
  /** 疑似漂移的集号(去重升序) */
  suspectEpisodes: number[];
  /** 有效比对数(参与打分的 [集×角色] 对数) */
  compared: number;
  available: boolean;
}

/** 默认相似度阈值:低于它标 suspect(经验值,多模态嵌入同人不同姿态通常 >0.8)。 */
export const SERIES_CONSISTENCY_THRESHOLD = 0.75;

/**
 * 跨集一致性打分(纯函数):每个 [集×角色] 对与圣经基准算余弦。
 * 基准缺该角色 / 向量维度不合 → 该对跳过(不计 compared,不误报)。
 */
export function scoreSeriesConsistency(
  refs: RefEmbedding[],
  episodes: EpisodeCharEmbedding[],
  opts?: { threshold?: number },
): SeriesConsistencyResult {
  const threshold = opts?.threshold ?? SERIES_CONSISTENCY_THRESHOLD;
  const refByName = new Map(refs.filter((r) => Array.isArray(r.vector) && r.vector.length).map((r) => [r.name, r.vector]));
  const findings: ConsistencyFinding[] = [];
  for (const e of episodes) {
    const ref = refByName.get(e.name);
    if (!ref || !Array.isArray(e.vector) || e.vector.length !== ref.length) continue;
    const similarity = cosineSimilarity(ref, e.vector);
    findings.push({ episodeNumber: e.episodeNumber, name: e.name, similarity, suspect: similarity < threshold });
  }
  findings.sort((a, b) => a.similarity - b.similarity);
  return {
    findings,
    suspectEpisodes: Array.from(new Set(findings.filter((f) => f.suspect).map((f) => f.episodeNumber))).sort((a, b) => a - b),
    compared: findings.length,
    available: findings.length > 0,
  };
}
