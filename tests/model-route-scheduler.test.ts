import { describe, expect, it } from 'vitest';
import type { RuntimeModelRoute } from '@/lib/model-routing';
import {
  isUpstreamRateLimit,
  rateLimitDelayMs,
  routeMinIntervalMs,
} from '@/lib/model-route-scheduler';
import { formatProgressReply } from '@/services/agent-chat.service';

function route(limits: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  return {
    profile: { limits },
    gateway: { options },
  } as RuntimeModelRoute;
}

describe('model route scheduling and progress replies', () => {
  it('derives a minimum interval from route RPM limits', () => {
    expect(routeMinIntervalMs(route({ requestsPerMinute: 1 }))).toBe(60_000);
    expect(routeMinIntervalMs(route({ rpm: 4 }))).toBe(15_000);
    expect(routeMinIntervalMs(route({}, { minIntervalMs: 2500 }))).toBe(2500);
  });

  it('recognizes the Chinese upstream rate-limit response used by NewAPI', () => {
    const error = new Error('您已达到总请求数限制：1分钟内最多请求1次，包括失败次数');
    expect(isUpstreamRateLimit(error)).toBe(true);
    expect(rateLimitDelayMs(error)).toBe(60_000);
  });

  it('reports real video counts instead of a fixed demo response', () => {
    const reply = formatProgressReply({
      projectStatus: 'active', expectedVideos: 4, completedVideos: 1,
      animaticVideos: 0, failedVideos: 2,
      activeTask: '重新生成第 3 镜视频', activeProgress: 50,
      lastError: 'HTTP 401 invalid_api_key',
    });
    expect(reply).toContain('已生成 1/4 个');
    expect(reply).toContain('重新生成第 3 镜视频（50%）');
    expect(reply).toContain('invalid_api_key');
    expect(reply).not.toContain('视频参数已调整');
  });
});
