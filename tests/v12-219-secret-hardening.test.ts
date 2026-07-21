/**
 * v12.219 — 密钥与配置硬化回归锁。
 *
 * 两条尽调尾链:
 *   🔴-2 尾:JWT_SECRET 弱默认(.env.example 的 change_me_...)在生产可被据此伪造任意用户令牌。
 *   🟠-12:PLAN_GATE_DISABLED 误留生产 → 付费墙全开。
 *
 * 真行为断言(非 grep 源码):直接改 process.env 触发 getJwtSecret / checkPlan 的运行时分支,
 * 断言「生产弱密钥拒签发」「生产强制忽略 gate 开关」。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { signToken } from '@/app/api/auth/lib';
import { checkPlan } from '@/lib/plan-gate';

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'PLAN_GATE_DISABLED'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(k: string, v: string | undefined) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

describe('v12.219 JWT_SECRET 弱默认生产拒启', () => {
  const WEAK = 'change_me_to_a_random_32_char_string';

  it('生产 + 弱默认 JWT_SECRET → signToken 抛错(拒签发)', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', WEAK);
    expect(() => signToken({ id: 'u1', role: 'user' })).toThrow(/占位|弱默认|weak/i);
  });

  it('生产 + 弱默认大小写/空格变体 → 仍拒(规范化挡绕过)', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', '  Change_Me  ');
    expect(() => signToken({ id: 'u1', role: 'user' })).toThrow();
  });

  it('生产 + 未设 JWT_SECRET → signToken 抛错', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', undefined);
    expect(() => signToken({ id: 'u1', role: 'user' })).toThrow(/未设置|JWT_SECRET/i);
  });

  it('生产 + 高强度随机密钥 → 正常签发', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', 'a3f9c1e7b28d4056af9127c3e5b8d0f1a3f9c1e7b28d4056af9127c3e5b8d0f1');
    const t = signToken({ id: 'u1', role: 'user' });
    expect(typeof t).toBe('string');
    expect(t.split('.').length).toBe(3);
  });

  it('非生产 + 弱默认 → 不抛错(降级进程级随机密钥)', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('JWT_SECRET', WEAK);
    expect(() => signToken({ id: 'u1', role: 'user' })).not.toThrow();
  });
});

describe('v12.219 PLAN_GATE_DISABLED 生产强制忽略', () => {
  // 匿名请求(无 token)→ current=free;要 pro 档。
  const req = () => new Request('http://localhost/api/x');

  it('生产 + PLAN_GATE_DISABLED=1 → 仍 gate(免费用户 pro 功能被拦)', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('PLAN_GATE_DISABLED', '1');
    const r = checkPlan(req(), 'pro');
    expect(r.ok).toBe(false);
    expect(r.current).toBe('free');
  });

  it('开发 + PLAN_GATE_DISABLED=1 → 放行(开关仅 dev 生效)', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('PLAN_GATE_DISABLED', '1');
    const r = checkPlan(req(), 'pro');
    expect(r.ok).toBe(true);
  });

  it('开发 + 未设开关 → 免费用户 pro 功能被 gate', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('PLAN_GATE_DISABLED', undefined);
    const r = checkPlan(req(), 'pro');
    expect(r.ok).toBe(false);
  });
});
