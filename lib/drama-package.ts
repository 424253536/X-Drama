/**
 * Drama Center 出海打包(v12.188.0)—— 纯函数:分集清单 + 定价建议。
 * TikTok Drama Center 2026Q1 分账 $2400 万、AI 短剧月分账 $200 万+;平台无公开
 * 直发 API(入驻制)→ 输出「一键可交」的打包清单(人工上传 10 分钟内完成)。
 * 定价建议按行业惯例:前 free 集免费引流,付费集按时长档位(coins)。
 */

export interface DramaEpisodeIn { episodeNumber: number; title: string; videoUrl: string; durationSec?: number }

export interface DramaPricing { episodeNumber: number; unlock: 'free' | 'coins'; coins: number }

export function suggestPricing(episodes: DramaEpisodeIn[], freeCount = 3): DramaPricing[] {
  return episodes.map((e) => {
    if (e.episodeNumber <= freeCount) return { episodeNumber: e.episodeNumber, unlock: 'free' as const, coins: 0 };
    const d = e.durationSec ?? 60;
    const coins = d >= 120 ? 60 : d >= 60 ? 45 : 30; // 行业常见档位
    return { episodeNumber: e.episodeNumber, unlock: 'coins' as const, coins };
  });
}

export function buildDramaPackage(input: {
  seriesTitle: string;
  language?: string;
  coverUrl?: string | null;
  episodes: DramaEpisodeIn[];
  freeCount?: number;
}) {
  const eps = [...input.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  return {
    platform: 'tiktok-drama-center',
    series: {
      title: input.seriesTitle,
      language: input.language || 'zh',
      episodeCount: eps.length,
      coverUrl: input.coverUrl || null,
      totalDurationSec: eps.reduce((t, e) => t + (e.durationSec ?? 0), 0),
    },
    episodes: eps,
    pricing: suggestPricing(eps, input.freeCount ?? 3),
    uploadGuide: [
      '1. Drama Center 后台 → Content → Create Series,粘贴系列标题/语言/封面',
      '2. 逐集上传 episodes[].videoUrl(集号即顺序),粘贴各集标题',
      '3. Monetization 按 pricing 建议设免费集与 coins 档位',
      '4. 提交审核(AI 内容需勾选 AI-generated 声明)',
    ],
  };
}
