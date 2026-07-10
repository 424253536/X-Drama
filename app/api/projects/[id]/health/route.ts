/**
 * GET /api/projects/[id]/health (v12.153) — 成片全维体检报告。
 *
 * 探测走本地路径(serve-file ?path= 解码 / ?key= resolveByKey 还原),
 * ffprobe 全维 + 纯判定(lib/film-health)。读免鉴权,与 pull-sheet GET 同哲学。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { probeMediaFull, buildFilmHealthReport } from '@/lib/film-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** serve-file URL → 本地绝对路径(?path= 直解 / ?key= 注册表反查);其余原样。 */
function toLocalPath(url: string): string {
  try {
    if (!url.startsWith('/api/serve-file')) return url;
    const q = new URLSearchParams(url.split('?')[1] || '');
    const p = q.get('path');
    if (p) return decodeURIComponent(p);
    const key = q.get('key');
    if (key) {
      const { resolveByKey } = require('@/lib/asset-storage') as typeof import('@/lib/asset-storage');
      const hit = resolveByKey(key);
      if (hit) return hit.absPath;
    }
  } catch { /* fallthrough */ }
  return url;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 成片:final_video 资产最新一条
  const finals = await listAssetsByType(id, 'final_video');
  const finalRow = finals.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))[0];
  const finalUrl = finalRow ? (finalRow.persistent_url || (parseJson(finalRow.media_urls) || [])[0] || '') : '';
  const finalProbe = finalUrl ? await probeMediaFull(toLocalPath(finalUrl)) : null;

  // 剧本预期时长/镜数
  const scriptRows = await listAssetsByType(id, 'script');
  let script: any = parseJson(scriptRows[0]?.data);
  if (!Array.isArray(script?.shots)) {
    const r = db.prepare('SELECT script_data, aspect FROM projects WHERE id = ?').get(id) as any;
    script = parseJson(r?.script_data) || {};
  }
  const shots: any[] = Array.isArray(script?.shots) ? script.shots : [];
  const expected = shots.length
    ? shots.reduce((t, s) => t + (typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5), 0)
    : null;

  // 每镜视频 + 降级识别(与 v12.150 batch 同款)
  const videoRows = await listAssetsByType(id, 'video');
  const withVideo = videoRows.filter((r) => {
    const urls = parseJson(r.media_urls) || [];
    return !!(r.persistent_url || urls[0]);
  });
  const animaticShots = videoRows.filter((r) => {
    const d = parseJson(r.data) || {};
    const urls = parseJson(r.media_urls) || [];
    return d.isAnimatic === true || /animatic-\d+\.mp4/.test(String(urls[0] || ''));
  }).map((r) => r.shot_number as number).filter((n) => typeof n === 'number').sort((a, b) => a - b);

  const projRow = db.prepare('SELECT aspect FROM projects WHERE id = ?').get(id) as { aspect?: string } | undefined;

  const report = buildFilmHealthReport({
    finalProbe,
    hasFinalAsset: !!finalUrl,
    projectAspect: projRow?.aspect || '16:9',
    expectedDurationSec: expected,
    shotTotal: shots.length,
    shotWithVideo: withVideo.length,
    animaticShots,
  });

  return NextResponse.json({ ...report, animaticShots, probedAt: new Date().toISOString() });
}
