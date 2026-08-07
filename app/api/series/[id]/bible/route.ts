/**
 * /api/series/[id]/bible (v12.266 · Phase 0 系列圣经) —— 生成前的系列级资产。
 *
 * POST:通读该系列**全部集**的分集剧情 → LLM 提炼「角色(不限 3)/场景/道具」圣经,
 *      并为缺图条目生成设定图(角色全身设定 / 场景空镜 / 道具特写;styleBible 作 sref 锁画风),
 *      存 series_anchors.data.bible —— 之后逐集生成按"本集出场谁"从圣经动态选角注入。
 *      重复 POST 幂等续跑:同名条目已有设定图则跳过(不重复计费);单次出图上限 maxImages(默认 20),
 *      超出的下次 POST 续生成。
 * GET:查看当前圣经。
 * PUT:用户修改/确认圣经(白名单净化;confirmed=true 表示定稿)。
 *
 * 安全:登录 + 只动本人系列;LLM 限流;出图走预算护栏(每张粗估 ¥0.3)。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodesFull, getSeriesAnchor, setSeriesAnchor } from '@/lib/repos/series-repo';
import {
  extractSeriesBible, sanitizeSeriesBible, type SeriesBible,
} from '@/lib/series-bible';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { rateLimit, isRateLimitActive } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function urlOf(a: any): string | undefined {
  if (!a) return undefined;
  if (a.persistent_url) return a.persistent_url;
  try { const m = JSON.parse(a.media_urls || '[]'); return Array.isArray(m) ? m[0] : undefined; } catch { return undefined; }
}

/** 校验属主并取全部集(集号升序);空 → null。 */
async function ownedEpisodes(seriesId: string, userId: string) {
  const eps = await listSeriesEpisodesFull(seriesId, userId);
  return eps.length ? eps : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await ownedEpisodes(id, payload.sub))) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });
  const anchor = await getSeriesAnchor(id);
  return NextResponse.json({ ok: true, bible: anchor?.bible ?? null });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await ownedEpisodes(id, payload.sub))) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });

  let body: any = {}; try { body = await request.json(); } catch {}
  if (!body?.bible || typeof body.bible !== 'object') return NextResponse.json({ error: '需要 bible 对象' }, { status: 400 });
  const bible = sanitizeSeriesBible(body.bible);
  if (!bible.characters.length && !bible.scenes.length && !bible.props.length) {
    return NextResponse.json({ error: '圣经为空(净化后无有效条目)' }, { status: 400 });
  }
  const prev = (await getSeriesAnchor(id)) || {};
  await setSeriesAnchor(id, { ...prev, bible });
  return NextResponse.json({ ok: true, bible });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = payload.sub;

  // LLM 限流(与 /series/split 同哲学,提取比拆集重 → 更紧)
  if (isRateLimitActive()) {
    const rl = rateLimit(`series-bible:${userId}`, { limit: 5, windowMs: 60_000 });
    if (!rl.allowed) return NextResponse.json({ error: '请求过于频繁,请稍后再试' }, { status: 429 });
  }

  const eps = await ownedEpisodes(id, userId);
  if (!eps) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });

  let body: any = {}; try { body = await request.json(); } catch {}
  const generateImages = body?.generateImages !== false; // 默认生成设定图
  const maxImages = Math.max(0, Math.min(40, Number(body?.maxImages) || 20));

  // ── 1. LLM 通读全部集 → 圣经骨架 ──
  let bible: SeriesBible;
  try {
    bible = await extractSeriesBible(
      eps.map((e, i) => ({ episodeNumber: e.episode_number ?? i + 1, text: e.description || '' })),
    );
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 502 });
  }

  // ── 2. 续跑保图:同名条目沿用已有设定图(重 POST 不重复出图/计费) ──
  const prev = (await getSeriesAnchor(id)) || {};
  const old = prev.bible;
  if (old) {
    const keep = <T extends { name?: string; location?: string; imageUrl?: string }>(list: T[], oldList: T[]) => {
      const byKey = new Map(oldList.map((o) => [(o.name ?? o.location ?? '').trim(), o.imageUrl]));
      for (const item of list) {
        const u = byKey.get((item.name ?? item.location ?? '').trim());
        if (!item.imageUrl && u) item.imageUrl = u;
      }
    };
    keep(bible.characters, old.characters);
    keep(bible.scenes as any[], old.scenes as any[]);
    keep(bible.props, old.props);
  }

  // ── 3. 缺图条目生成设定图(角色 → 场景 → 道具;styleBible 作 sref 锁画风) ──
  const failures: Array<{ kind: string; name: string; error: string }> = [];
  let generated = 0;
  if (generateImages && maxImages > 0) {
    type Job = { kind: 'character' | 'scene' | 'prop'; name: string; prompt: string; aspect: string; set: (u: string) => void };
    const jobs: Job[] = [
      ...bible.characters.filter((c) => !c.imageUrl).map((c): Job => ({
        kind: 'character', name: c.name, aspect: '3:4',
        prompt: `Character design sheet, full body, neutral standing pose, clean plain background. ${c.name}: ${c.description}. Consistent single character, high detail, no text, no watermark.`,
        set: (u) => { c.imageUrl = u; },
      })),
      ...bible.scenes.filter((s) => !s.imageUrl).map((s): Job => ({
        kind: 'scene', name: s.location, aspect: '16:9',
        prompt: `Establishing shot of a recurring drama location, empty of people. ${s.location}: ${s.description}. Cinematic lighting, consistent architecture, high detail, no text, no watermark.`,
        set: (u) => { s.imageUrl = u; },
      })),
      ...bible.props.filter((p) => !p.imageUrl).map((p): Job => ({
        kind: 'prop', name: p.name, aspect: '1:1',
        prompt: `Prop design reference, single object centered on clean neutral background. ${p.name}: ${p.description}. Product-photography clarity, high detail, no text, no watermark.`,
        set: (u) => { p.imageUrl = u; },
      })),
    ].slice(0, maxImages);

    if (jobs.length) {
      const { assertBudget } = await import('@/lib/budget-enforce');
      const b = await assertBudget({ userId, pendingCostCny: jobs.length * 0.3 });
      if (!b.allow) return NextResponse.json({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });

      const styleRef = urlOf((await listAssetsByType(eps[0].id, 'styleBible'))[0]);
      await import('@/lib/image-providers/builtins');
      const { dispatchImageGenerate } = await import('@/lib/image-providers/registry');
      for (const job of jobs) {
        try {
          const gen = await dispatchImageGenerate(
            { prompt: job.prompt, aspectRatio: job.aspect as any, sref: styleRef, label: `bible:${job.kind}:${job.name}` },
            { refCount: styleRef ? 1 : 0 },
          );
          if (gen.result?.imageUrl) {
            const persisted = await persistAsset(gen.result.imageUrl, { ext: 'png' }).catch(() => null);
            job.set(persisted?.url || gen.result.imageUrl);
            generated++;
          } else {
            failures.push({ kind: job.kind, name: job.name, error: gen.tried.map((t) => t.error).join('|').slice(0, 120) });
          }
        } catch (e) {
          failures.push({ kind: job.kind, name: job.name, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
        }
      }
    }
  }

  // ── 4. 落库(净化后写回;保留旧 confirmed 需用户重新确认 → 重提取后默认未确认) ──
  const finalBible = sanitizeSeriesBible({ ...bible, generatedAt: new Date().toISOString() });
  await setSeriesAnchor(id, { ...prev, bible: finalBible });

  const missing =
    finalBible.characters.filter((c) => !c.imageUrl).length +
    finalBible.scenes.filter((s) => !s.imageUrl).length +
    finalBible.props.filter((p) => !p.imageUrl).length;
  return NextResponse.json({
    ok: true,
    bible: finalBible,
    images: { generated, failed: failures, missing }, // missing>0 → 再 POST 一次续生成
  });
}
