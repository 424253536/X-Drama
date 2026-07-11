/**
 * v3.5 — 字幕烧录平台预设.
 *
 * 不同平台的"爆款字幕"风格不一样: 抖音大白字粗黑边居中偏下, 小红书细字暖色,
 * YouTube 规矩白字黑底. 这文件把这些固化成预设, 生成 ffmpeg `subtitles` 滤镜的
 * `force_style` 串, 一键烧录.
 *
 * 纯函数, 单测: tests/v3-5-subtitle-burn.test.ts.
 */

export type SubtitlePlatform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'youtube' | 'tiktok' | 'default';

export interface SubtitleStyle {
  /** 字体名 (系统需装, 否则 ffmpeg 回退默认). */
  fontName: string;
  /** 字号 (基于 1080p, ffmpeg 按 PlayResY 缩放). */
  fontSize: number;
  /** 主色, ASS BGR hex `&HBBGGRR`. */
  primaryColour: string;
  /** 描边色. */
  outlineColour: string;
  /** 描边粗细 px. */
  outline: number;
  /** 阴影 px. */
  shadow: number;
  /** 底部边距 px. */
  marginV: number;
  /** ASS 对齐 (numpad: 2=底中, 5=正中, 8=顶中). */
  alignment: number;
  /** 是否加粗 (-1 = 是, 0 = 否, ASS 约定). */
  bold: number;
}

const PRESETS: Record<SubtitlePlatform, SubtitleStyle> = {
  // 抖音: 大白字 + 粗黑边 + 居中偏下, 信息密度高也看得清
  douyin: {
    fontName: 'PingFang SC', fontSize: 56, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 4, shadow: 1, marginV: 120, alignment: 2, bold: -1,
  },
  // 快手: 比抖音更大更粗, 下沉一点
  kuaishou: {
    fontName: 'PingFang SC', fontSize: 60, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 5, shadow: 1, marginV: 140, alignment: 2, bold: -1,
  },
  // 小红书: 细一点, 暖白, 描边淡, 偏精致
  xiaohongshu: {
    fontName: 'PingFang SC', fontSize: 48, primaryColour: '&H00F0F8FF',
    outlineColour: '&H00404040', outline: 2, shadow: 0, marginV: 160, alignment: 2, bold: 0,
  },
  // YouTube: 规矩白字黑描边, 字号适中
  youtube: {
    fontName: 'Arial', fontSize: 44, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 3, shadow: 1, marginV: 60, alignment: 2, bold: 0,
  },
  // TikTok: 竖屏大白字粗描边, 上抬避开右侧操作栏/底部话题, 与抖音同源略瘦
  tiktok: {
    fontName: 'Arial', fontSize: 52, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 4, shadow: 1, marginV: 180, alignment: 2, bold: -1,
  },
  default: {
    fontName: 'PingFang SC', fontSize: 50, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 3, shadow: 1, marginV: 100, alignment: 2, bold: 0,
  },
};

export function listSubtitlePlatforms(): SubtitlePlatform[] {
  return Object.keys(PRESETS) as SubtitlePlatform[];
}

/**
 * v12.180:按语种/平台选跨平台字体 —— PRESETS 硬编码 PingFang SC(macOS 专有),
 * Linux 部署烧韩/俄字幕会静默豆腐块。优先级:SUBTITLE_FONT env > 语种专属 > 平台预设原值(mac 上仍最优)。
 * Linux 部署方需安装 fonts-noto-cjk / fonts-noto-core(README 部署节已述)。
 */
export function fontForLanguage(lang?: string | null, presetFont?: string, env: Record<string, string | undefined> = process.env, platform: string = typeof process !== 'undefined' ? process.platform : 'linux'): string | null {
  if (env.SUBTITLE_FONT) return env.SUBTITLE_FONT;
  const l = (lang || '').toLowerCase();
  const isDarwin = platform === 'darwin';
  if (l === 'ko') return isDarwin ? 'Apple SD Gothic Neo' : 'Noto Sans KR';
  if (l === 'ja') return isDarwin ? 'Hiragino Sans' : 'Noto Sans JP';
  if (l === 'ru' || l === 'de' || l === 'fr' || l === 'es' || l === 'pt') return isDarwin ? (presetFont || null) : 'DejaVu Sans';
  if (l === 'zh') return isDarwin ? (presetFont || null) : 'Noto Sans CJK SC';
  return null; // 未指定语种 → 不覆盖预设(YouTube 等西文平台的 Arial 必须保留;CI Linux 抓到的真行为 bug)
}

/** 取平台预设. 未知平台回退 default. 返回拷贝, 防外部 mutate. lang 可选 —— 语种字体覆盖(v12.180). */
export function getSubtitleStyle(platform: SubtitlePlatform | string, lang?: string | null): SubtitleStyle {
  const p = (PRESETS as Record<string, SubtitleStyle>)[platform];
  const style = { ...(p ?? PRESETS.default) };
  const f = fontForLanguage(lang, style.fontName);
  if (f) style.fontName = f;
  return style;
}

/** 允许在预设基础上覆盖个别字段. */
export function getSubtitleStyleWithOverrides(
  platform: SubtitlePlatform | string,
  overrides: Partial<SubtitleStyle> = {},
): SubtitleStyle {
  return { ...getSubtitleStyle(platform), ...overrides };
}

/** SubtitleStyle → ASS force_style 串 (逗号分隔 K=V). */
export function styleToForceStyle(style: SubtitleStyle): string {
  const pairs: Array<[string, string | number]> = [
    ['FontName', style.fontName],
    ['FontSize', style.fontSize],
    ['PrimaryColour', style.primaryColour],
    ['OutlineColour', style.outlineColour],
    ['Outline', style.outline],
    ['Shadow', style.shadow],
    ['MarginV', style.marginV],
    ['Alignment', style.alignment],
    ['Bold', style.bold],
  ];
  return pairs.map(([k, v]) => `${k}=${v}`).join(',');
}

/** ffmpeg path 转义 — `:` `'` `\` 在 filtergraph 里有特殊含义, 要转义. */
export function escapeSubtitlePath(p: string): string {
  // filtergraph: 反斜杠先转, 再转冒号 (Windows 盘符) 和单引号
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * 生成完整的 `-vf subtitles=...` 滤镜串.
 * @param srtOrAssPath 字幕文件路径 (.srt / .ass)
 * @param platform 平台预设
 * @param overrides 覆盖字段
 */
export function buildSubtitlesFilter(
  srtOrAssPath: string,
  platform: SubtitlePlatform | string = 'default',
  overrides: Partial<SubtitleStyle> = {},
  lang?: string | null, // v12.180:目标语种(字体覆盖:ko/ja/ru 等跨平台可显)
): string {
  if (!srtOrAssPath) throw new Error('buildSubtitlesFilter: empty subtitle path');
  const style = getSubtitleStyleWithOverrides(platform, overrides);
  if (!overrides.fontName) { // 显式覆盖优先;否则按语种/平台选可显字体
    const f = fontForLanguage(lang, style.fontName);
    if (f) style.fontName = f;
  }
  const force = styleToForceStyle(style);
  const escaped = escapeSubtitlePath(srtOrAssPath);
  return `subtitles='${escaped}':force_style='${force}'`;
}
