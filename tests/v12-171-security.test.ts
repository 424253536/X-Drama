/**
 * v12.171 — 安全双修:仓库零明文凭据 + demo seed 环境开关 + 幂等密码轮换。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';

describe('v12.171 · 安全', () => {
  it('全仓(git tracked)零明文演示密码', () => {
    const hits = execSync("git grep -l 'Qfmanju123' -- '*.ts' '*.tsx' '*.html' '*.md' || true", { encoding: 'utf-8' }).trim();
    expect(hits).toBe('');
  });
  it('公开调试页已删除', () => {
    expect(fs.existsSync('public/test-buttons.html')).toBe(false);
  });
  it('db seed:SEED_DEMO_USER 开关 + DEMO_PASSWORD env + 幂等轮换', () => {
    const db = fs.readFileSync('lib/db.ts', 'utf-8');
    expect(db).toContain("process.env.SEED_DEMO_USER === '0'");
    expect(db).toContain('process.env.DEMO_PASSWORD');
    expect(db).toContain('demo 密码已按 DEMO_PASSWORD 轮换');
    expect(db).not.toContain("hashSync('Qfmanju123'");
  });
  it('auth 页不再预填/展示明文密码', () => {
    const p = fs.readFileSync('app/auth/page.tsx', 'utf-8');
    expect(p).toContain("useState('')");
    expect(p).not.toContain('Qfmanju123');
  });
  it('.env.example 覆盖关键新 env', () => {
    const e = fs.readFileSync('.env.example', 'utf-8');
    for (const k of ['DEMO_PASSWORD', 'SEED_DEMO_USER', 'VIDEO_ENGINE_ORDER', 'WRITER_MAX_TOKENS', 'TTS_VOICE_JA_FEMALE', 'PEXELS_API_KEY']) {
      expect(e).toContain(k);
    }
  });
});
