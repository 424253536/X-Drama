'use client';

import { Database, Pulse as Activity } from '@phosphor-icons/react';
import { ApiChannelManager } from '@/components/api-channel-manager';

export default function ApiConfigPage() {
  return (
    <div className="max-w-6xl mx-auto pb-20">
      <header className="mb-7 pr-12">
        <div className="flex items-start justify-between gap-5 flex-wrap">
          <div className="max-w-2xl">
            <div className="cinema-eyebrow mb-2 flex items-center gap-2">
              <Activity size={13} className="text-[var(--primary)]" /> LIVE CONFIGURATION
            </div>
            <h1 className="text-[clamp(1.75rem,3vw,2.6rem)] leading-none font-semibold tracking-[-0.045em] text-[var(--text)]">
              API 路由台
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)] text-pretty">
              连接一个或多个 NewAPI 网关，为每个网关维护多种模型，并按逻辑模型设置跨网关优先级。
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] border border-[var(--border)] bg-[var(--surface)] rounded-lg px-3 py-2">
            <Database size={14} className="text-[var(--primary)]" />
            <span>加密落库</span>
            <span className="text-[var(--soft)]">·</span>
            <span>运行时热更新</span>
          </div>
        </div>
      </header>

      <ApiChannelManager />
    </div>
  );
}
