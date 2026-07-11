/**
 * v12.164/165 — 遗留双修 + 语言体系全链:纯函数 + 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { getSystemLanguage, setSystemLanguage } from '@/lib/system-language';
import { buildShortVideoMessages } from '@/lib/short-video';
import { getRhythmTemplate } from '@/lib/short-video';
import { normalizeLanguage, languageDisplayName, ttsLangCode } from '@/lib/language-detect';
import fs from 'fs';

describe('v12.164 · 遗留双修', () => {
  it('Writer:输出预算铁律 + WRITER_MAX_TOKENS 提档', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('输出预算铁律');
    expect(src).toContain("process.env.WRITER_MAX_TOKENS || '', 10) || 24576");
  });
  it('网关 401 也进冷却(key 失效不再每镜撞)', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect((src.match(/res\.status === 401 \|\| res\.status === 402/g) || []).length).toBe(2);
  });
});

describe('v12.165 · 语言体系', () => {
  it('俄日韩语种注册完整:归一/展示名/TTS 语码', () => {
    for (const [alias, code, tts] of [['俄语', 'ru', 'ru-RU'], ['日本語', 'ja', 'ja-JP'], ['korean', 'ko', 'ko-KR']] as const) {
      const norm = normalizeLanguage(alias, '');
      expect(norm).toBe(code);
      expect(ttsLangCode(norm)).toBe(tts);
      expect(languageDisplayName(norm)).toBeTruthy();
    }
  });
  it('系统默认语言:SSR 安全返回 auto(node 环境无 localStorage)', () => {
    expect(getSystemLanguage()).toBe('auto');
    expect(() => setSystemLanguage('ru')).not.toThrow();
  });
  it('短视频 planner:language 注入语言铁律;不传不注入', () => {
    const rhythm = getRhythmTemplate(undefined);
    const withLang = buildShortVideoMessages({ idea: 'test', style: '', durationS: 15, rhythm, language: 'Русский' });
    expect(withLang.system).toContain('语言铁律');
    expect(withLang.system).toContain('Русский');
    const noLang = buildShortVideoMessages({ idea: 'test', style: '', durationS: 15, rhythm });
    expect(noLang.system).not.toContain('语言铁律');
  });
  it('接线锁:series generate 复用已读 body 透传 language;创作页/短视频挂选择器;系列面板带系统语言', () => {
    const gen = fs.readFileSync('app/api/series/[id]/generate/route.ts', 'utf-8');
    expect(gen).toContain("body?.language === 'string'");
    expect(gen).not.toContain('reqBody = await request.json'); // 禁二次读 body
    expect(gen).toContain('language, // v12.165');
    expect(fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8')).toContain('<LanguagePicker');
    expect(fs.readFileSync('app/dashboard/short-video/page.tsx', 'utf-8')).toContain('sv-language');
    expect(fs.readFileSync('app/dashboard/series/[id]/page.tsx', 'utf-8')).toContain('language: getSystemLanguage()');
    expect(fs.readFileSync('app/api/short-video/plan/route.ts', 'utf-8')).toContain('languageDisplayName');
  });
  it('TTS 下达链:orchestrator 配音按 targetLanguage 的 ttsLangCode', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('ttsLangCode(this.targetLanguage())');
  });
});
