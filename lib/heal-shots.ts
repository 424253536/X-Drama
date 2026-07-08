/**
 * 缺失/降级镜自愈识别(v12.125.0)。
 *
 * 病根:成片有缺失镜(供给翻车,missing-video)/ 兜底镜(kenburns/broll)/ 烤字镜(video-baked-text)时,
 * quality_report 只如实记账,补救全靠人工翻日志+逐镜重生。本模块从质检报告识别「可自愈镜」,
 * 供 `/heal-shots` 端点在供给恢复后一键补拍 → 重合成。纯逻辑(识别/排序/优先级)可单测。
 *
 * 可自愈类:missing-video(最急,内容直接没了)> video-baked-text(画面带烤字,重生求干净)
 *          > kenburns-fallback(静图动画,重生求真动态)> broll-fallback(实拍兜底,重生求 AI 定制)。
 */

export type HealReason = 'missing-video' | 'video-baked-text' | 'kenburns-fallback' | 'broll-fallback';

export const HEALABLE_KINDS: readonly string[] = ['missing-video', 'video-baked-text', 'kenburns-fallback', 'broll-fallback'];

export interface HealableShot {
  shot: number;
  reasons: string[];       // 该镜命中的全部事件类
  healable: string[];      // 其中可自愈的类(HEALABLE_KINDS ∩ reasons)
  hasStoryboard: boolean;  // 有分镜图 → 可 I2V 首帧锚定补拍;无 → 只能 T2V(质量次之)
  priority: number;        // 4 缺失 > 3 烤字 > 2 静图兜底 > 1 实拍兜底
}

/** 纯函数:某镜可自愈类的最高优先级(缺失最急)。 */
export function healPriority(kinds: string[]): number {
  if (kinds.includes('missing-video')) return 4;
  if (kinds.includes('video-baked-text')) return 3;
  if (kinds.includes('kenburns-fallback')) return 2;
  if (kinds.includes('broll-fallback')) return 1;
  return 0;
}

/**
 * 从质检报告识别可自愈镜。优先用 v12.125+ 的 `shotReasons`(精准 shot→kind);
 * 旧报告(仅 degradedShots)降级:degradedShots 视为可自愈(reason='degraded',无细分)。
 * @param storyboardShots 有分镜图的镜号列表(决定 I2V/T2V 与是否值得补)。
 */
export function identifyHealableShots(
  report: { shotReasons?: Record<number, string[]>; degradedShots?: number[] } | null | undefined,
  storyboardShots: number[] = [],
): HealableShot[] {
  if (!report) return [];
  const sbSet = new Set(storyboardShots);
  const out: HealableShot[] = [];
  const shotReasons = report.shotReasons || {};

  if (Object.keys(shotReasons).length > 0) {
    for (const [shotStr, reasons] of Object.entries(shotReasons)) {
      const shot = Number(shotStr);
      if (!(shot > 0)) continue;
      const healable = (reasons || []).filter((k) => HEALABLE_KINDS.includes(k));
      if (healable.length === 0) continue;
      out.push({ shot, reasons, healable, hasStoryboard: sbSet.has(shot), priority: healPriority(healable) });
    }
  } else if (report.degradedShots?.length) {
    // 旧报告兜底:只知哪些镜降级,不知具体类
    for (const shot of report.degradedShots) {
      if (!(shot > 0)) continue;
      out.push({ shot, reasons: ['degraded'], healable: ['degraded'], hasStoryboard: sbSet.has(shot), priority: 2 });
    }
  }

  out.sort((a, b) => b.priority - a.priority || a.shot - b.shot);
  return out;
}
