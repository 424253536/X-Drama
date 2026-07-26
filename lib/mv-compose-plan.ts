/**
 * lib/mv-compose-plan — MV 出片:卡点镜头 + 一组图片 → 每镜静帧动画规格(v12.253)。
 *
 * MV 规划(mv-plan)只给卡点时间轴;出片还需给每镜配一张画面。本层做**纯映射**:
 * 把 N 张图按序循环分配到各卡点镜头,带上该镜的卡点时长 + 轮换的 ken-burns 方向(更有动感)。
 * 真正的 ffmpeg 静帧转视频 + 卡点拼接 + 配乐在端点层(stillFrameToVideo + composeVideo),这里只算「怎么分」。
 */
import type { MvShot } from './mv-plan';

export interface MvClipSpec {
  shotNumber: number;
  imageUrl: string;
  durationSec: number;
  zoomDir: 'in' | 'out' | 'pan';
}

const ZOOMS: Array<'in' | 'out' | 'pan'> = ['in', 'out', 'pan'];

/**
 * 卡点镜头 × 图片 → 每镜一段静帧动画的规格。图片不足时循环复用;ken-burns 方向逐镜轮换。
 * shots 或 imageUrls 为空 → 空数组(端点据此回 400,不进 ffmpeg)。
 */
export function assignMvClips(shots: MvShot[], imageUrls: string[]): MvClipSpec[] {
  if (!shots?.length || !imageUrls?.length) return [];
  return shots.map((s, i) => ({
    shotNumber: s.index,
    imageUrl: imageUrls[i % imageUrls.length],
    durationSec: s.durationSec,
    zoomDir: ZOOMS[i % ZOOMS.length],
  }));
}
