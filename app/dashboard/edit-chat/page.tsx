'use client';

/**
 * /dashboard/edit-chat · 对话式编辑台(v12.250 前端入口 → v12.248 /api/edit-intent/parse)
 *
 * 对话式编辑的前端入口:对成片用自然语言说「删掉第3镜,改成竖屏卡点字幕,节奏快一点」→
 * 后端解析成一组**编辑意图** → 本页渲染成「我将:①… ②…」确认卡。
 *
 * 安全契约(与后端一致):解析**不执行**。破坏性意图(删镜/重生/重配音)标红并要求二次确认。
 * 「确认执行」当前禁用 —— 执行需接线到既有 recompose / regenerate-shot 端点,是下一步(页内如实标注)。
 */

import { useState } from 'react';
import { ChatText, PaperPlaneRight, Warning as AlertTriangle, CircleNotch as Loader2, CheckCircle, ShieldWarning } from '@phosphor-icons/react';
import { useToast } from '@/components/ui/toast-provider';

interface ParseResult {
  intents: unknown[];
  describe: string[];
  destructive: boolean;
  unmatched: boolean;
  hint?: string;
}

const EXAMPLES = [
  '删掉第3镜,改成竖屏卡点字幕',
  '节奏快一点,适配抖音',
  '第2镜调暗一点',
  '重新配音',
];

export default function EditChatPage() {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const { showToast } = useToast();

  const parse = async (override?: string) => {
    const q = (override ?? text).trim();
    if (!q) { showToast({ title: '先说一句要改什么', type: 'error' }); return; }
    if (override) setText(override);
    setParsing(true);
    setErrorMsg('');
    setResult(null);
    try {
      const res = await fetch('/api/edit-intent/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.message || `解析失败 (HTTP ${res.status})`;
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      // 防御:200 但返回异常/非 JSON(body 被兜成 {})时,ok 不为 true → 明示报错,别让下面的
      // result.describe.length 撞 undefined 崩页。同时把数组字段归一,渲染永不 undefined.length。
      if (!body || body.ok !== true) {
        const msg = '解析返回异常,请重试';
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setResult({
        intents: Array.isArray(body.intents) ? body.intents : [],
        describe: Array.isArray(body.describe) ? body.describe : [],
        destructive: !!body.destructive,
        unmatched: !!body.unmatched,
        hint: typeof body.hint === 'string' ? body.hint : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,解析失败';
      setErrorMsg(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ChatText className="w-6 h-6 text-[#E8C547]" weight="duotone" />
          对话式编辑台
        </h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          对成片用大白话说要改什么 → 解析成一组编辑意图,确认后调既有 recompose / regenerate-shot。
          <span className="text-[var(--soft)]"> 解析只读,破坏性操作(删镜/重配音)必须二次确认。</span>
        </p>
      </div>

      {/* 输入区 */}
      <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 space-y-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) parse(); }}
          placeholder="例如:删掉第3镜,改成竖屏卡点字幕,节奏快一点"
          maxLength={2000}
          rows={3}
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map(ex => (
            <button key={ex} onClick={() => parse(ex)} disabled={parsing}
              className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[11px] text-[var(--muted)] disabled:opacity-40">
              {ex}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--soft)] opacity-60">⌘/Ctrl + Enter 解析 · {text.length}/2000</span>
          <button
            onClick={() => parse()}
            disabled={parsing || !text.trim()}
            className="px-4 py-2 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center gap-2 text-sm"
          >
            {parsing ? (<><Loader2 className="w-4 h-4 animate-spin" /> 解析中…</>) : (<><PaperPlaneRight className="w-4 h-4" weight="bold" /> 解析</>)}
          </button>
        </div>
      </div>

      {/* 结果区 */}
      <div className="mt-5">
        {errorMsg ? (
          <div className="bg-[rgba(255,255,255,0.04)] border border-rose-500/20 rounded-2xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
            <div className="text-sm text-rose-300 mb-1">解析失败</div>
            <div className="text-[11px] text-white/50">{errorMsg}</div>
          </div>
        ) : result ? (
          result.unmatched || (result.describe?.length ?? 0) === 0 ? (
            <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 text-[13px] text-[var(--muted)]">
              {result.hint || '没听懂这句 —— 换个说法试试(如「删掉第3镜」「改成竖屏卡点字幕」)。'}
            </div>
          ) : (
            <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-4 h-4 text-emerald-400" weight="duotone" />
                <span className="text-sm text-white font-medium">我将执行以下 {result.describe.length} 项修改:</span>
              </div>
              <ol className="space-y-2 mb-4">
                {result.describe.map((d, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="w-5 h-5 rounded-full bg-[#E8C547]/15 text-[#E8C547] grid place-items-center text-[11px] font-mono shrink-0 mt-0.5">{i + 1}</span>
                    <span className="text-[var(--text)]">{d}</span>
                  </li>
                ))}
              </ol>

              {result.destructive && (
                <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/25 px-3 py-2 mb-4">
                  <ShieldWarning className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" weight="duotone" />
                  <span className="text-[12px] text-rose-200/90">
                    含删镜 / 重生 / 重配音等**花钱或不可逆**操作 —— 执行前需你二次确认。
                  </span>
                </div>
              )}

              {/* 执行按钮:后端骨架阶段禁用。保住「解析不执行」契约,不误导用户以为已生效。 */}
              <button
                disabled
                title="执行链路(映射到既有 recompose / regenerate-shot)接线中,当前仅解析预览"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 text-[var(--soft)] font-medium cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                确认执行(接线中)
              </button>
              <p className="text-[11px] text-[var(--soft)] mt-3 opacity-70 leading-relaxed">
                ✦ 下一步:把这些意图接到既有 recompose / regenerate-shot 端点执行;破坏性操作走二次确认弹窗。
                本页是解析骨架,执行接线跟进。
              </p>
            </div>
          )
        ) : (
          <div className="text-center text-[var(--soft)] text-sm opacity-60 py-10">
            说一句要改什么,或点上面的示例 —— 解析出的意图会以确认卡形式出现在这里。
          </div>
        )}
      </div>
    </div>
  );
}
