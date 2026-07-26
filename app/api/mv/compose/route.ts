/**
 * POST /api/mv/compose — MV 出片:卡点时间轴 + 一组图片 → 卡点成片(v12.253)。
 *
 * body: { musicDurationSec, bpm, beatsPerShot?, imageUrls: string[], musicUrl?, aspect? }
 * → planMvShots 出卡点镜头 → 每图 persistAsset 落地(继承 SSRF/验签/大小上限)→ stillFrameToVideo
 *   逐镜静帧动画(ken-burns)→ composeVideo 按卡点硬切拼接 + 配乐 → 返回成片签名 URL。
 *
 * 纯本地 ffmpeg,无付费生成外呼 —— 只需登录守卫。为控时长/内存,镜头数封顶(超了让用户调大每镜拍数)。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { persistAsset } from '@/lib/asset-storage';
import { planMvShots } from '@/lib/mv-plan';
import { assignMvClips } from '@/lib/mv-compose-plan';
import { serveFilePathUrl } from '@/lib/serve-file-sign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 出片镜头上限:每镜一次 ffmpeg 静帧转视频,太多会超时/吃内存。超了让用户调大每镜拍数。 */
const MAX_MV_SHOTS = 24;
/** 一次最多接受的图片数(防超大 body)。 */
const MAX_IMAGES = 40;
/**
 * 图片单边像素上限。字节 <64MB 不代表安全:一张 80B 的 SVG 声明 100000×100000,或高压缩的超大 PNG,
 * 都能让 ffmpeg/librsvg 光栅化时吃几十 GB 内存 OOM。落地后用 sharp 读**声明尺寸**(不光栅化,便宜)卡上限。
 */
const MAX_IMAGE_DIM = 8000;
const SAFE_URL = /^(https?:|data:image\/|\/api\/serve-file)/;

/**
 * 每用户在途合成数(内存级):一个用户同时只能有一个 MV 合成在跑。挡「开 10 个 tab 狂点」把 CPU/临时盘打爆。
 * 非分布式限流(多实例下每实例各算),但足以拦最常见的单用户并发滥用;正式限流靠基建层。
 */
const inFlight = new Set<string>();

export async function POST(request: NextRequest) {
  const g = requireUser(request);
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }

  const musicDurationSec = Number(body?.musicDurationSec);
  const bpm = Number(body?.bpm);
  if (!Number.isFinite(musicDurationSec) || musicDurationSec <= 0 || musicDurationSec > 600) {
    return NextResponse.json({ message: 'musicDurationSec 需为正数且 ≤ 600' }, { status: 400 });
  }
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) {
    return NextResponse.json({ message: 'bpm 需在 1~400 之间' }, { status: 400 });
  }

  const rawImages: unknown = body?.imageUrls;
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    return NextResponse.json({ message: '需要 imageUrls(至少一张画面)' }, { status: 400 });
  }
  const imageUrls = rawImages
    .filter((u): u is string => typeof u === 'string' && SAFE_URL.test(u.trim()))
    .map((u) => u.trim())
    .slice(0, MAX_IMAGES);
  if (imageUrls.length === 0) {
    return NextResponse.json({ message: 'imageUrls 需为 http(s)/data:image/站内 serve-file' }, { status: 400 });
  }

  const aspect = ['16:9', '9:16', '1:1'].includes(body?.aspect) ? body.aspect : '9:16';

  const shots = planMvShots({
    musicDurationSec,
    bpm,
    beatsPerShot: Number.isFinite(Number(body?.beatsPerShot)) ? Number(body.beatsPerShot) : undefined,
  });
  if (shots.length === 0) {
    return NextResponse.json({ message: '按此参数算不出卡点镜头,请调整时长/BPM' }, { status: 400 });
  }
  if (shots.length > MAX_MV_SHOTS) {
    return NextResponse.json({
      message: `卡点镜头 ${shots.length} 个超过出片上限 ${MAX_MV_SHOTS} —— 调大「每镜拍数」或缩短音乐再试`,
    }, { status: 400 });
  }

  const specs = assignMvClips(shots, imageUrls);

  // 每用户单并发:已有在途合成 → 429,别让一个用户 N 个请求把机器打爆。
  if (inFlight.has(g.userId)) {
    return NextResponse.json({ message: '你已有一个 MV 正在合成,请等它完成再试' }, { status: 429 });
  }
  inFlight.add(g.userId);

  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  // 每请求唯一目录:防同用户并发合成共享目录、互相覆盖中间帧/片段。
  const outputDir = path.join(os.tmpdir(), `mv-compose-${g.userId.slice(0, 8)}-${Date.now()}`);

  try {
    const { stillFrameToVideo, composeVideo } = await import('@/services/video-composer');
    const sharp = (await import('sharp')).default;

    // 1) 每图落地(SSRF/验签/大小上限继承)→ 尺寸卡上限 → stillFrameToVideo 出每镜卡点静帧动画。
    const clips: Array<{ shotNumber: number; videoUrl: string; duration: number; transition: string }> = [];
    for (const spec of specs) {
      const persisted = await persistAsset(spec.imageUrl);
      if (!persisted?.absPath) {
        return NextResponse.json({ message: `图片无法获取或被安全策略拒绝:${spec.imageUrl.slice(0, 60)}` }, { status: 400 });
      }
      // 尺寸护栏:读声明尺寸(sharp metadata 不光栅化,便宜),挡超大 SVG viewport / 超大栅格图 OOM。
      let dim: { width?: number; height?: number };
      try {
        dim = await sharp(persisted.absPath).metadata();
      } catch {
        return NextResponse.json({ message: `图片无法解析(可能不是有效图片):${spec.imageUrl.slice(0, 60)}` }, { status: 400 });
      }
      if (!dim.width || !dim.height || dim.width > MAX_IMAGE_DIM || dim.height > MAX_IMAGE_DIM) {
        return NextResponse.json({ message: `图片尺寸超上限(单边 ≤ ${MAX_IMAGE_DIM}px):${spec.imageUrl.slice(0, 60)}` }, { status: 400 });
      }
      const clipPath = await stillFrameToVideo(persisted.absPath, spec.durationSec, outputDir, spec.zoomDir);
      clips.push({ shotNumber: spec.shotNumber, videoUrl: clipPath, duration: spec.durationSec, transition: 'cut' });
    }

    // 2) 可选配乐:落地后用签名 serve-file URL(composeVideo 只认 http / /api/serve-file)。
    let musicUrl: string | undefined;
    const rawMusic = typeof body?.musicUrl === 'string' ? body.musicUrl.trim() : '';
    if (rawMusic && /^(https?:|\/api\/serve-file)/.test(rawMusic)) {
      const m = await persistAsset(rawMusic);
      if (m?.absPath) musicUrl = serveFilePathUrl(m.absPath);
    }

    // 3) 卡点硬切拼接 + 配乐。成片在 composeVideo 自己的 tmp 目录(qf-compose-*),不在本请求的
    // outputDir 里,所以 finally 清 outputDir 不会误删成片。
    const result = await composeVideo({ clips, aspect, musicUrl, musicVolume: 0.5 });
    const finalUrl = serveFilePathUrl(result.outputPath);
    return NextResponse.json({
      ok: true,
      finalVideoUrl: finalUrl,
      shotCount: shots.length,
      duration: result.totalDuration,
      aspect,
    });
  } catch (e) {
    return NextResponse.json({ message: `MV 合成失败:${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 });
  } finally {
    // 清中间静帧片段目录(成功/中途 400/异常都清),防临时盘无限堆积;解除在途标记。
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* noop */ }
    inFlight.delete(g.userId);
  }
}
