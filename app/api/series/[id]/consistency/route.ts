/**
 * GET /api/series/[id]/consistency (v12.266) —— 跨集一致性质检报告。
 *
 * 各集角色资产图 vs 系列圣经设定图的 embedding 相似度,标出疑似漂移的 [集×角色]。
 * **报告不阻断**:结果供用户挑集重生成,不做硬门禁(图像相似度误报率撑不起阻断)。
 * 诚实降级:未配 IMAGE_EMBED_MODEL / 无圣经 → available:false + reason,不假装体检过。
 *
 * 成本护栏:embedding 调用按 [集×角色] 对数计,上限 120 对(60 集 × 主角 2 位的量级),
 * 超出的集截断并在 truncated 里如实回报。安全:登录 + 本人系列。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodes, getSeriesAnchor } from '@/lib/repos/series-repo';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { hasImageEmbeddingKey, embedImage } from '@/lib/asset-embedding';
import {
  matchBibleCharacterName, scoreSeriesConsistency, SERIES_CONSISTENCY_THRESHOLD,
  type RefEmbedding, type EpisodeCharEmbedding,
} from '@/lib/series-consistency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_PAIRS = 120;

function urlOf(a: any): string | undefined {
  if (a?.persistent_url) return a.persistent_url;
  try { const m = JSON.parse(a?.media_urls || '[]'); return Array.isArray(m) ? m[0] : undefined; } catch { return undefined; }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eps = await listSeriesEpisodes(id, payload.sub);
  if (eps.length === 0) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });

  const anchor = await getSeriesAnchor(id);
  const bibleChars = (anchor?.bible?.characters || []).filter((c) => c.imageUrl);
  if (!bibleChars.length) {
    return NextResponse.json({ ok: true, available: false, reason: '无系列圣经(或圣经角色无设定图)—— 先 POST /api/series/[id]/bible' });
  }
  if (!hasImageEmbeddingKey()) {
    return NextResponse.json({ ok: true, available: false, reason: '未配置图像嵌入能力(IMAGE_EMBED_MODEL)—— 跨集比对需要 BYO 多模态嵌入' });
  }

  // ── 1. 圣经基准 embedding(每角色一次) ──
  const refs: RefEmbedding[] = [];
  for (const c of bibleChars) {
    const emb = await embedImage(c.imageUrl as string);
    if (emb) refs.push({ name: c.name, vector: emb.vector });
  }
  if (!refs.length) {
    return NextResponse.json({ ok: true, available: false, reason: '圣经设定图 embedding 全部失败(嵌入端点异常?)' });
  }

  // ── 2. 各集角色资产图 embedding(只查已完成的集;对数超限截断并如实回报) ──
  const bibleNames = refs.map((r) => r.name);
  const episodeEmbeds: EpisodeCharEmbedding[] = [];
  let pairs = 0;
  let truncated = false;
  for (const ep of eps) {
    if (ep.status !== 'completed' || typeof ep.episode_number !== 'number') continue;
    if (pairs >= MAX_PAIRS) { truncated = true; break; }
    const charRows = await listAssetsByType(ep.id, 'character');
    for (const row of charRows) {
      const matched = matchBibleCharacterName(bibleNames, row.name || '');
      const url = urlOf(row);
      if (!matched || !url) continue;
      if (pairs >= MAX_PAIRS) { truncated = true; break; }
      pairs++;
      const emb = await embedImage(url);
      if (emb) episodeEmbeds.push({ episodeNumber: ep.episode_number, name: matched, vector: emb.vector });
    }
  }

  const result = scoreSeriesConsistency(refs, episodeEmbeds);
  return NextResponse.json({
    ok: true,
    available: result.available,
    ...(result.available ? {} : { reason: '没有可比对的 [集×角色](各集还没生成角色资产,或名字对不上圣经)' }),
    threshold: SERIES_CONSISTENCY_THRESHOLD,
    compared: result.compared,
    suspectEpisodes: result.suspectEpisodes,
    findings: result.findings,
    truncated, // true → 集数太多,只查了前 120 对
  });
}
