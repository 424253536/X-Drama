/**
 * v12.166 — 剧本语种守门:检测/判定纯函数 + 双保险接线锁。
 */
import { describe, it, expect } from 'vitest';
import { textMatchesLanguage, scriptLanguageMismatch, needsLanguageFix, buildLanguageFixPrompt } from '@/lib/language-guard';
import fs from 'fs';

describe('v12.166 · textMatchesLanguage', () => {
  it('日语必含假名;纯汉字判不符;韩俄按主体字符', () => {
    expect(textMatchesLanguage('静けさこそ、力だ。', 'ja')).toBe(true);
    expect(textMatchesLanguage('续航够。828公里', 'ja')).toBe(false);   // live 事故样本
    expect(textMatchesLanguage('엄마, 봐! 빛이야!', 'ko')).toBe(true);
    expect(textMatchesLanguage('Тишина — это сила', 'ru')).toBe(true);
    expect(textMatchesLanguage('妈妈你看!光!', 'ru')).toBe(false);
    expect(textMatchesLanguage('OK!', 'ja')).toBe(true);              // 太短不判
    expect(textMatchesLanguage('見ない。心动就试试静寂の光,下一个惊喜是你。', 'ja')).toBe(false); // live 混语句
    expect(textMatchesLanguage('航続は十分だ、まだ828キロ走れる。', 'ja')).toBe(true);
    expect(textMatchesLanguage('', 'ja')).toBe(true);
  });
  it('needsLanguageFix:过半不符才修;zh 永不修;样本<2 不修', () => {
    const badJa = { shots: [{ dialogue: '我们试试看' }, { dialogue: '续航够。828公里' }, { narration: '妈妈你看' }] };
    expect(needsLanguageFix(badJa, 'ja')).toBe(true);
    const goodJa = { shots: [{ dialogue: '行ってみよう' }, { dialogue: '航続は十分。828キロ' }] };
    expect(needsLanguageFix(goodJa, 'ja')).toBe(false);
    expect(needsLanguageFix(badJa, 'zh')).toBe(false);
    expect(needsLanguageFix({ shots: [{ dialogue: '短' }] }, 'ja')).toBe(false);
    const m = scriptLanguageMismatch(badJa, 'ja');
    expect(m.checked).toBe(3); expect(m.mismatched).toBe(3);
  });
  it('修复 prompt:只翻文案字段、结构保留、只回 JSON', () => {
    const p = buildLanguageFixPrompt('Japanese', '日本語');
    expect(p).toContain('dialogue');
    expect(p).toContain('byte-identical');
    expect(p).toContain('Japanese');
  });
  it('接线锁:Pass2 user 端二次铁律 + startProduction 产后守门', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain("this.targetLanguage() !== 'zh' ? buildLanguageDirective");
    expect(src).toContain('needsLanguageFix(script, this._targetLanguage)');
    expect(src).toContain('本地化为');
  });
});
