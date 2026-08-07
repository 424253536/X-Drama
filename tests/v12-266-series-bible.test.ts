/**
 * v12.266 —— 系列圣经(Phase 0 系列级资产)+ 完整分集剧本导入 + 跨集一致性。
 *
 * 覆盖:
 * ① 完整剧本不再 2000 截断(buildEpisodeIdea,上限 32000)+ 集数上限 50 → 可配置默认 200;
 * ② 圣经净化/解析(白名单、容量上限、中文键容错);
 * ③ 按集动态选角(出场匹配、role 优先级、≤3、兜底、无图剔除);
 * ④ 场景/道具跨集传播形状(归一 location、先到基线优先、http 过滤);
 * ⑤ 锚点合并:有圣经时角色锚不被本集覆盖(防群像漂移),无圣经维持旧语义;
 * ⑥ 跨集一致性评分(阈值、维度不合跳过、可疑集聚合)。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { validateSeriesInput, maxSeriesEpisodes, buildEpisodeIdea, EPISODE_IDEA_CAP } from '@/lib/series';
import {
  sanitizeSeriesBible, parseSeriesBible, pickEpisodeCharacters,
  bibleSceneAnchorEntries, biblePropRefs, mergeSceneAnchorEntries, mergeSeriesAnchorOnEpisodeDone,
  BIBLE_MAX_CHARACTERS, type SeriesBible,
} from '@/lib/series-bible';
import { matchBibleCharacterName, scoreSeriesConsistency } from '@/lib/series-consistency';

const IMG = 'https://cdn.example.com/x.png';

function bibleWith(chars: Array<Partial<SeriesBible['characters'][number]> & { name: string }>): SeriesBible {
  return sanitizeSeriesBible({
    characters: chars.map((c) => ({ role: 'supporting', description: '', imageUrl: IMG, ...c })),
    scenes: [], props: [],
  });
}

// ── ① 完整分集剧本导入 ──────────────────────────────────────────────────────

describe('v12.266 · 完整剧本导入:取消 2000 截断', () => {
  it('5000 字剧情完整保留(旧代码在 2000 截断)', () => {
    const long = '戏'.repeat(5000);
    const idea = buildEpisodeIdea({ description: long, title: 't' });
    expect(idea.length).toBe(5000);
    expect(idea).toBe(long);
  });

  it('上限对齐单集创作路径 32000;前情 directive 原样前置', () => {
    const over = 'x'.repeat(EPISODE_IDEA_CAP + 500);
    expect(buildEpisodeIdea({ description: over }).length).toBe(EPISODE_IDEA_CAP);
    expect(buildEpisodeIdea({ description: '正文' }, '【前情】')).toBe('【前情】正文');
    expect(buildEpisodeIdea({ description: null, title: '第3集 复仇' })).toBe('第3集 复仇');
  });
});

describe('v12.266 · 集数上限 50 → 可配置(默认 200)', () => {
  afterEach(() => { delete process.env.SERIES_MAX_EPISODES; });

  it('60 集不再被拒(旧上限 50)', () => {
    const eps = Array.from({ length: 60 }, (_, i) => ({ premise: `第${i + 1}集剧情` }));
    expect(validateSeriesInput(eps).ok).toBe(true);
  });

  it('默认上限 200;超出报错并提示可调', () => {
    expect(maxSeriesEpisodes()).toBe(200);
    const eps = Array.from({ length: 201 }, () => ({ premise: 'p' }));
    const v = validateSeriesInput(eps);
    expect(v.ok).toBe(false);
    expect(v.error).toContain('200');
  });

  it('SERIES_MAX_EPISODES 可调;非法值回退默认', () => {
    process.env.SERIES_MAX_EPISODES = '80';
    expect(maxSeriesEpisodes()).toBe(80);
    expect(validateSeriesInput(Array.from({ length: 81 }, () => ({ premise: 'p' }))).ok).toBe(false);
    process.env.SERIES_MAX_EPISODES = 'abc';
    expect(maxSeriesEpisodes()).toBe(200);
  });
});

// ── ② 圣经净化/解析 ────────────────────────────────────────────────────────

describe('v12.266 · sanitizeSeriesBible 白名单净化', () => {
  it('非法输入 → 空圣经;字段白名单 + 容量上限', () => {
    expect(sanitizeSeriesBible(null)).toEqual({ characters: [], scenes: [], props: [] });
    expect(sanitizeSeriesBible([1, 2])).toEqual({ characters: [], scenes: [], props: [] });

    const raw = {
      characters: Array.from({ length: 30 }, (_, i) => ({
        name: `角${i}`, role: i === 0 ? 'lead' : 'bad-role', cw: 999,
        imageUrl: i % 2 ? IMG : 'javascript:alert(1)',
        aliases: ['小名', '', 42], episodes: [3, 3, 1, -5, 'x'],
        evil: 'dropped',
      })),
      scenes: [{ name: '公寓', description: 'd' }, { location: '', description: 'skip' }],
      props: [{ name: '玉佩', description: '祖传', imageUrl: IMG }],
    };
    const b = sanitizeSeriesBible(raw);
    expect(b.characters.length).toBe(BIBLE_MAX_CHARACTERS); // 30 → 20
    expect(b.characters[0].role).toBe('lead');
    expect(b.characters[1].role).toBe('supporting'); // 非法 role 回退
    expect(b.characters[0].cw).toBe(125); // clamp
    expect((b.characters[0] as any).evil).toBeUndefined();
    expect(b.characters[0].imageUrl).toBeUndefined(); // 非 http 剔除
    expect(b.characters[1].imageUrl).toBe(IMG);
    expect(b.characters[0].aliases).toEqual(['小名']);
    expect(b.characters[0].episodes).toEqual([1, 3]); // 去重排序去非法
    expect(b.scenes).toEqual([{ location: '公寓', description: 'd' }]); // name → location 兼容;空 location 剔除
    expect(b.props[0]).toEqual({ name: '玉佩', description: '祖传', imageUrl: IMG });
  });
});

describe('v12.266 · parseSeriesBible 容错解析', () => {
  it('剥 fence + 中文键名', () => {
    const content = '```json\n{"角色":[{"name":"陆晚晚","role":"lead","description":"银发"}],"场景":[],"道具":[{"name":"玉佩","description":"信物"}]}\n```';
    const b = parseSeriesBible(content);
    expect(b?.characters[0].name).toBe('陆晚晚');
    expect(b?.props[0].name).toBe('玉佩');
  });

  it('坏 JSON / 空内容 → null', () => {
    expect(parseSeriesBible('not json')).toBeNull();
    expect(parseSeriesBible('')).toBeNull();
    expect(parseSeriesBible('{"characters":[]}')).toBeNull(); // 全空也算无效
  });
});

// ── ③ 按集动态选角 ─────────────────────────────────────────────────────────

describe('v12.266 · pickEpisodeCharacters 按集动态选角', () => {
  it('按 episodes 集号 + 文本别名匹配出场;role 优先级排序;≤3', () => {
    const bible = bibleWith([
      { name: '男主', role: 'lead', episodes: [1, 5] },
      { name: '男二', role: 'supporting', episodes: [5] },
      { name: '大反派', role: 'antagonist', aliases: ['黑衣人'] },
      { name: '路人甲', role: 'cameo', episodes: [2] },
      { name: '女主', role: 'lead', episodes: [5] },
    ]);
    const picked = pickEpisodeCharacters(bible, '第五集:黑衣人现身,男主与女主对峙', 5);
    expect(picked.length).toBe(3); // 命中 4 个(男主/男二/反派/女主),引擎硬上限截 3
    expect(picked.map((c) => c.name)).toEqual(['男主', '女主', '大反派']); // lead > antagonist;路人甲未出场
    expect(picked[0].cw).toBe(100); // lead 默认 cw
    expect(picked[2].cw).toBe(80);
  });

  it('第 5 集才登场的角色也有锚(核心修复:旧全局固定 3 个覆盖不到)', () => {
    const bible = bibleWith([
      { name: '男主', role: 'lead', episodes: [1, 2, 3, 4] },
      { name: '神秘男二', role: 'supporting', episodes: [5, 6] },
    ]);
    const picked = pickEpisodeCharacters(bible, '', 5);
    expect(picked.map((c) => c.name)).toContain('神秘男二');
  });

  it('判不出出场 → 兜底按优先级取(主角永不缺锚);无图角色剔除;空圣经 → []', () => {
    const bible = bibleWith([
      { name: '配角', role: 'supporting' },
      { name: '主角', role: 'lead' },
      { name: '没图的', role: 'lead', imageUrl: undefined },
    ]);
    const picked = pickEpisodeCharacters(bible, '完全无关的文本', null);
    expect(picked[0].name).toBe('主角');
    expect(picked.map((c) => c.name)).not.toContain('没图的');
    expect(pickEpisodeCharacters(null, 'x', 1)).toEqual([]);
    expect(pickEpisodeCharacters(sanitizeSeriesBible({}), 'x', 1)).toEqual([]);
  });
});

// ── ④ 场景/道具传播形状 ────────────────────────────────────────────────────

describe('v12.266 · 场景锚/道具参考传播', () => {
  it('bibleSceneAnchorEntries:location 归一(seed 不再归一,必须此处做)+ 无图剔除', () => {
    const bible = sanitizeSeriesBible({
      scenes: [
        { location: '男主 公寓!', description: 'd', imageUrl: IMG },
        { location: '没图的大堂', description: 'd' },
      ],
    });
    expect(bibleSceneAnchorEntries(bible)).toEqual([{ location: '男主公寓', description: 'd', url: IMG }]);
  });

  it('mergeSceneAnchorEntries:归一去重,先到基线优先(最早集不被后集覆盖)', () => {
    const merged = mergeSceneAnchorEntries(
      [{ location: '男主公寓', url: 'https://a/1.png' }],
      [{ location: '男主,公寓', url: 'https://a/2.png' }, { location: '公司大堂', url: 'https://a/3.png' }],
    );
    expect(merged.length).toBe(2);
    expect(merged[0]).toMatchObject({ location: '男主公寓', url: 'https://a/1.png' }); // 首图保留
    expect(merged[1].location).toBe('公司大堂');
  });

  it('biblePropRefs:http(s) 与站内 /api/serve-file 都接受(persistAsset 形状),其余拒', () => {
    const bible = sanitizeSeriesBible({ props: [
      { name: '玉佩', description: '', imageUrl: IMG },
      { name: '信', description: '', imageUrl: '/api/serve-file?key=abc' },
      { name: '合同', description: '' },
      { name: '毒', description: '', imageUrl: 'javascript:alert(1)' },
    ] });
    expect(biblePropRefs(bible)).toEqual([IMG, '/api/serve-file?key=abc']);
  });
});

// ── ⑤ 收尾锚点合并 ─────────────────────────────────────────────────────────

describe('v12.266 · mergeSeriesAnchorOnEpisodeDone', () => {
  const epChars = [{ name: '本集临时角色', imageUrl: IMG, role: 'lead', cw: 100 }];

  it('有圣经 → 角色锚不被本集覆盖(圣经真源,防群像漂移)', () => {
    const prev = {
      lockedCharacters: [{ name: '男主', imageUrl: IMG }],
      bible: bibleWith([{ name: '男主', role: 'lead' as const }]),
    };
    const next = mergeSeriesAnchorOnEpisodeDone(prev, { characters: epChars, episodeNumber: 7 });
    expect(next.lockedCharacters).toEqual(prev.lockedCharacters);
    expect(next.bible).toBe(prev.bible); // 圣经原样保留
    expect(next.fromEpisode).toBe(7);
  });

  it('无圣经 → 维持旧语义(本集角色 > 上集沉淀);场景锚增量并入', () => {
    const prev = { lockedCharacters: [{ name: '旧', imageUrl: IMG }], sceneAnchors: [{ location: '公寓', url: 'https://a/1.png' }] };
    const next = mergeSeriesAnchorOnEpisodeDone(prev, {
      characters: epChars,
      styleAnchorUrl: 'https://a/style.png',
      sceneEntries: [{ location: '天台', url: 'https://a/4.png' }, { location: '公寓', url: 'https://a/override.png' }],
    });
    expect(next.lockedCharacters).toEqual(epChars);
    expect(next.styleAnchorUrl).toBe('https://a/style.png');
    expect(next.sceneAnchors?.map((s) => s.url)).toEqual(['https://a/1.png', 'https://a/4.png']); // 公寓首图不被覆盖
    // 本集没出角色 → 保留上集沉淀
    expect(mergeSeriesAnchorOnEpisodeDone(prev, { characters: [] }).lockedCharacters).toEqual(prev.lockedCharacters);
  });
});

// ── ⑥ 跨集一致性评分 ───────────────────────────────────────────────────────

describe('v12.266 · 跨集一致性(报告不阻断)', () => {
  it('matchBibleCharacterName:精确 > 子串;<2 字不匹配', () => {
    expect(matchBibleCharacterName(['陆晚晚', '男主'], '陆晚晚')).toBe('陆晚晚');
    expect(matchBibleCharacterName(['陆晚晚'], '陆晚晚(青年)')).toBe('陆晚晚');
    expect(matchBibleCharacterName(['陆晚晚'], '王')).toBeNull();
    expect(matchBibleCharacterName(['陆晚晚'], '完全无关')).toBeNull();
  });

  it('低于阈值标 suspect;维度不合/无基准跳过;可疑集聚合', () => {
    const refs = [{ name: 'A', vector: [1, 0] }, { name: 'B', vector: [0, 1] }];
    const r = scoreSeriesConsistency(refs, [
      { episodeNumber: 1, name: 'A', vector: [1, 0.05] },   // ≈1 一致
      { episodeNumber: 3, name: 'A', vector: [0, 1] },      // 0 漂移
      { episodeNumber: 3, name: 'B', vector: [0.1, 1] },    // ≈1 一致
      { episodeNumber: 4, name: 'C', vector: [1, 1] },      // 无基准 → 跳过
      { episodeNumber: 5, name: 'A', vector: [1, 0, 0] },   // 维度不合 → 跳过
    ], { threshold: 0.75 });
    expect(r.available).toBe(true);
    expect(r.compared).toBe(3);
    expect(r.suspectEpisodes).toEqual([3]);
    expect(r.findings[0]).toMatchObject({ episodeNumber: 3, name: 'A', suspect: true }); // 最可疑在前
    expect(r.findings[0].similarity).toBeLessThan(0.75);
  });

  it('无可比对 → available:false(诚实降级)', () => {
    const r = scoreSeriesConsistency([], [{ episodeNumber: 1, name: 'A', vector: [1] }]);
    expect(r.available).toBe(false);
    expect(r.compared).toBe(0);
  });
});
