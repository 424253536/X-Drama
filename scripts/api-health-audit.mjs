#!/usr/bin/env node
/**
 * API 健康巡检 —— 清点欠费 / 异常 / 未配置的 API。
 *
 * 原则:
 *  · 只打**免费的鉴权/余额/列表类**接口,绝不触发计费生成(不发图/不出视频/不合成语音)。
 *  · 全程**不打印任何 key 值**,只显示掩码(前 4 + 后 4)。
 *  · 判定分级:OK / 欠费(402、insufficient balance)/ 鉴权失败(401、403)/ 异常 / 未配置(占位符或缺失)。
 *
 * 用法:node scripts/api-health-audit.mjs
 */
import fs from 'fs';
import path from 'path';

// ⚠️ 关键:Node 的 fetch(undici)**默认不认系统代理**,而本机全局挂 ClashX(HTTPS_PROXY=127.0.0.1:7890)。
// 不挂代理时,只能经代理到达的服务(如 api.vectorengine.ai)会报 UND_ERR_CONNECT_TIMEOUT ——
// **把「key 其实完全有效」误判成「网络异常」**(首轮巡检就踩了这个坑,curl 能通而 node 不能,
// 因为 curl 认 *_proxy 环境变量)。
// 注意:`process.env.NODE_USE_ENV_PROXY='1'` 写在脚本里**无效** —— undici 在启动时就读完了该开关,
// 进程内再设已经太晚(实测仍 CONNECT_TIMEOUT)。必须显式装 ProxyAgent。
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || '';
if (PROXY) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(PROXY));
    console.log(`[巡检] 已挂系统代理 ${PROXY}(否则只走代理的服务会被误判为网络异常)`);
  } catch (e) {
    console.warn('[巡检] ⚠️ 挂代理失败,只走代理的服务可能被误报为「异常」:', e.message);
  }
}

// ── 读 .env.local(不经 dotenv 依赖) ─────────────────────────────────
const envPath = path.join(process.cwd(), '.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}
const E = (k, d = '') => env[k] || process.env[k] || d;

const mask = (s) => (!s ? '(空)' : s.length <= 10 ? '****' : `${s.slice(0, 4)}…${s.slice(-4)} (${s.length}字符)`);
const isPlaceholder = (s) => !s || /^your_|_here$|^sk-xxx|^changeme/i.test(s);

const TIMEOUT_MS = 20000;
async function req(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const text = await r.text().catch(() => '');
    return { status: r.status, ok: r.ok, text: text.slice(0, 600) };
  } catch (e) {
    return { status: 0, ok: false, text: `NETWORK: ${e.name === 'AbortError' ? '超时' : e.message}`.slice(0, 200) };
  }
}

/** 从响应里嗅探"欠费/额度耗尽"信号 —— 各家措辞不一,统一归类。 */
function detectArrears(status, text) {
  const t = (text || '').toLowerCase();
  if (status === 402) return true;
  // ⚠️ 措辞坑:青云top 额度耗尽时返回 **HTTP 401** + "Token quota exhausted" —— 既不是 402,
  // 也不含 exceed/insufficient。首版词典漏了 `quota.*exhaust`,把「欠费」误判成「鉴权失败」,
  // 直接导致处置建议错成「重新生成 key」(实际该充值)。新增措辞务必同时覆盖 exhausted/depleted/用尽。
  return /insufficient|欠费|余额不足|balance|quota.*(exceed|exhaust|deplet|run out)|(exceed|exhaust|deplet).*quota|credit.*(exhaust|deplet)|no.*credit|arrear|额度(不足|用尽|耗尽)|已用完|用尽|not enough/i.test(t);
}
function detectAuthFail(status, text) {
  const t = (text || '').toLowerCase();
  if (status === 401 || status === 403) return true;
  return /invalid.*(api.?key|token)|unauthorized|鉴权失败|认证失败|无效的?密钥/i.test(t);
}

const results = [];
function record(name, keyName, keyVal, verdict, detail, extra = '') {
  results.push({ name, keyName, masked: mask(keyVal), verdict, detail, extra });
}

/** OpenAI 兼容网关:GET /v1/models(免费) */
async function probeOpenAICompat(name, keyName, baseUrl, key, modelsPath = '/v1/models') {
  if (isPlaceholder(key)) return record(name, keyName, key, '未配置', '占位符/缺失');
  const base = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const r = await req(`${base}${modelsPath}`, { headers: { Authorization: `Bearer ${key}` } });
  if (r.status === 0) return record(name, keyName, key, '异常', r.text);
  if (detectArrears(r.status, r.text)) return record(name, keyName, key, '欠费', `HTTP ${r.status}`);
  if (detectAuthFail(r.status, r.text)) return record(name, keyName, key, '鉴权失败', `HTTP ${r.status}`);
  if (r.ok) {
    let n = 0;
    try { const j = JSON.parse(r.text); n = (j.data || j.models || []).length; } catch { /* 列表大时被截断,不影响 OK 判定 */ }
    return record(name, keyName, key, 'OK', `HTTP 200`, n ? `可见模型 ${n}+` : '');
  }
  return record(name, keyName, key, '异常', `HTTP ${r.status} ${r.text.slice(0, 120)}`);
}

const tasks = [];

// ── ① 青云top 网关(OPENAI/CREATIVE/VEO/VIDU/QINGYUNTOP 共用同一家) ──
const qytBase = E('QINGYUNTOP_BASE_URL', 'https://api.qingyuntop.top');
// ⚠️ 青云top 对「重复使用无效 token」有 120s 限流(实测:同一把坏 key 连打 5 次即被封窗口,
//    且每次重试都会**重置**计时器)。这 5 个变量在本项目里常是同一把 key —— 去重后只探一次,
//    既避免自我限流,也避免把「429 限流」误读成别的问题。
const qytVars = ['OPENAI_API_KEY', 'CREATIVE_API_KEY', 'QINGYUNTOP_API_KEY', 'VEO_API_KEY', 'VIDU_API_KEY'];
const qytGroups = new Map(); // key 值 → 共用它的变量名
for (const kn of qytVars) {
  const v = E(kn);
  if (!qytGroups.has(v)) qytGroups.set(v, []);
  qytGroups.get(v).push(kn);
}
for (const [val, names] of qytGroups) {
  const label = `青云top 网关(${names.join(' / ')})`;
  tasks.push(() => probeOpenAICompat(label, names.join('+'), qytBase, val));
}

// ── ② DeepSeek:官方余额接口(直接给钱数) ──
tasks.push(async () => {
  const k = E('DEEPSEEK_API_KEY');
  if (isPlaceholder(k)) return record('DeepSeek', 'DEEPSEEK_API_KEY', k, '未配置', '占位符/缺失');
  const r = await req('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${k}` } });
  if (r.status === 0) return record('DeepSeek', 'DEEPSEEK_API_KEY', k, '异常', r.text);
  if (detectAuthFail(r.status, r.text)) return record('DeepSeek', 'DEEPSEEK_API_KEY', k, '鉴权失败', `HTTP ${r.status}`);
  if (r.ok) {
    try {
      const j = JSON.parse(r.text);
      const b = (j.balance_infos || [])[0];
      const total = b ? Number(b.total_balance) : NaN;
      const s = b ? `余额 ${b.total_balance} ${b.currency}` : 'available=' + j.is_available;
      if (j.is_available === false || (Number.isFinite(total) && total <= 0)) {
        return record('DeepSeek', 'DEEPSEEK_API_KEY', k, '欠费', s);
      }
      return record('DeepSeek', 'DEEPSEEK_API_KEY', k, 'OK', s);
    } catch { return record('DeepSeek', 'DEEPSEEK_API_KEY', k, 'OK', 'HTTP 200'); }
  }
  return record('DeepSeek', 'DEEPSEEK_API_KEY', k, '异常', `HTTP ${r.status} ${r.text.slice(0, 120)}`);
});

// ── ③ OpenRouter:官方 key 信息接口(含额度) ──
tasks.push(async () => {
  const k = E('OPENROUTER_API_KEY');
  if (isPlaceholder(k)) return record('OpenRouter', 'OPENROUTER_API_KEY', k, '未配置', '占位符/缺失');
  const r = await req('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${k}` } });
  if (r.status === 0) return record('OpenRouter', 'OPENROUTER_API_KEY', k, '异常', r.text);
  if (detectAuthFail(r.status, r.text)) return record('OpenRouter', 'OPENROUTER_API_KEY', k, '鉴权失败', `HTTP ${r.status}`);
  if (r.ok) {
    try {
      const d = JSON.parse(r.text).data || {};
      const used = Number(d.usage ?? 0), lim = d.limit;
      const remain = lim == null ? null : Number(lim) - used;
      if (remain != null && remain <= 0) return record('OpenRouter', 'OPENROUTER_API_KEY', k, '欠费', `已用 ${used}/${lim}`);
      return record('OpenRouter', 'OPENROUTER_API_KEY', k, 'OK', lim == null ? `已用 ${used},无硬上限` : `剩余 ${remain}`);
    } catch { return record('OpenRouter', 'OPENROUTER_API_KEY', k, 'OK', 'HTTP 200'); }
  }
  return record('OpenRouter', 'OPENROUTER_API_KEY', k, '异常', `HTTP ${r.status} ${r.text.slice(0, 120)}`);
});

// ── ④ VectorEngine(同时是 MJ 的 base) ──
tasks.push(() => probeOpenAICompat('VectorEngine(TTS/图)', 'VECTORENGINE_API_KEY', E('VECTORENGINE_BASE_URL', 'https://api.vectorengine.ai'), E('VECTORENGINE_API_KEY')));
tasks.push(() => probeOpenAICompat('Midjourney(经 VectorEngine)', 'MJ_API_KEY', E('MJ_BASE_URL', 'https://api.vectorengine.ai'), E('MJ_API_KEY')));

// ── ⑤ MiniMax:用 TTS 的 voice 列表类免费接口探鉴权 ──
tasks.push(async () => {
  const k = E('MINIMAX_API_KEY');
  const gid = E('MINIMAX_GROUP_ID');
  if (isPlaceholder(k)) return record('MiniMax', 'MINIMAX_API_KEY', k, '未配置', '占位符/缺失');
  const base = E('MINIMAX_BASE_URL', 'https://api.minimaxi.com').replace(/\/+$/, '');
  const q = isPlaceholder(gid) ? '' : `?GroupId=${encodeURIComponent(gid)}`;
  const r = await req(`${base}/v1/get_voice${q}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_type: 'system' }),
  });
  const extra = isPlaceholder(gid) ? '⚠️ MINIMAX_GROUP_ID 是占位符未填' : '';
  if (r.status === 0) return record('MiniMax', 'MINIMAX_API_KEY', k, '异常', r.text, extra);
  if (detectArrears(r.status, r.text)) return record('MiniMax', 'MINIMAX_API_KEY', k, '欠费', `HTTP ${r.status}`, extra);
  if (detectAuthFail(r.status, r.text)) return record('MiniMax', 'MINIMAX_API_KEY', k, '鉴权失败', `HTTP ${r.status}`, extra);
  // MiniMax 惯例:HTTP 200 但 base_resp.status_code 才是真状态
  try {
    const j = JSON.parse(r.text);
    const sc = j?.base_resp?.status_code, msg = j?.base_resp?.status_msg || '';
    if (sc === 0) return record('MiniMax', 'MINIMAX_API_KEY', k, 'OK', 'base_resp=0', extra);
    if (sc != null) {
      const v = detectArrears(0, msg) ? '欠费' : detectAuthFail(0, msg) ? '鉴权失败' : '异常';
      return record('MiniMax', 'MINIMAX_API_KEY', k, v, `base_resp=${sc} ${msg}`, extra);
    }
  } catch { /* 落到下方 */ }
  return record('MiniMax', 'MINIMAX_API_KEY', k, r.ok ? 'OK' : '异常', `HTTP ${r.status} ${r.text.slice(0, 120)}`, extra);
});

// ── ⑥ 可灵 Kling:查一个不存在的任务 id,只为区分「鉴权通过」与「鉴权失败」 ──
tasks.push(async () => {
  const k = E('KELING_API_KEY');
  if (isPlaceholder(k)) return record('可灵 Kling', 'KELING_API_KEY', k, '未配置', '占位符/缺失');
  const base = E('KELING_BASE_URL', 'https://api-beijing.klingai.com').replace(/\/+$/, '');
  const r = await req(`${base}/v1/videos/image2video/健康探活-不存在的任务`, { headers: { Authorization: `Bearer ${k}` } });
  if (r.status === 0) return record('可灵 Kling', 'KELING_API_KEY', k, '异常', r.text);
  if (detectArrears(r.status, r.text)) return record('可灵 Kling', 'KELING_API_KEY', k, '欠费', `HTTP ${r.status}`);
  if (detectAuthFail(r.status, r.text)) return record('可灵 Kling', 'KELING_API_KEY', k, '鉴权失败', `HTTP ${r.status} ${r.text.slice(0, 100)}`);
  // 404/任务不存在 = 鉴权已通过
  if (r.status === 404 || /not.*found|不存在/i.test(r.text)) return record('可灵 Kling', 'KELING_API_KEY', k, 'OK', '鉴权通过(任务不存在属预期)');
  return record('可灵 Kling', 'KELING_API_KEY', k, r.ok ? 'OK' : '异常', `HTTP ${r.status} ${r.text.slice(0, 120)}`);
});

// ── ⑦ Pexels:免费图库,搜 1 条 ──
// ⚠️ 必须**破缓存**:不加随机参数时,中间缓存层会对任意 key(哪怕伪造)返回同一条 200 +
//    同样的配额头 —— 实测真/假 key 响应逐字节相同,该探活等于什么都没验。加 _cb 后
//    真 key 得 200 + remaining,假 key 得 401 "Invalid API key",才有区分力。
tasks.push(async () => {
  const k = E('PEXELS_API_KEY');
  if (isPlaceholder(k)) return record('Pexels(素材)', 'PEXELS_API_KEY', k, '未配置', '占位符/缺失');
  const cb = Math.random().toString(36).slice(2, 10);
  const r = await req(`https://api.pexels.com/v1/search?query=sky&per_page=1&_cb=${cb}`, {
    headers: { Authorization: k, 'Cache-Control': 'no-cache' },
  });
  if (r.status === 0) return record('Pexels(素材)', 'PEXELS_API_KEY', k, '异常', r.text);
  if (detectAuthFail(r.status, r.text)) return record('Pexels(素材)', 'PEXELS_API_KEY', k, '鉴权失败', `HTTP ${r.status}`);
  if (r.status === 429) return record('Pexels(素材)', 'PEXELS_API_KEY', k, '异常', '429 限流(配额用尽)');
  return record('Pexels(素材)', 'PEXELS_API_KEY', k, r.ok ? 'OK' : '异常', `HTTP ${r.status}`);
});

// ── 执行(并发,互不阻塞) ──
console.log('开始 API 巡检 —— 仅调用免费鉴权/余额接口,不触发任何计费生成\n');
await Promise.all(tasks.map((t) => t().catch((e) => record('未知', '?', '', '异常', String(e).slice(0, 120)))));

const ICON = { OK: '✅', 欠费: '💸', 鉴权失败: '🔑', 异常: '⚠️ ', 未配置: '⬜' };
const ORDER = { 欠费: 0, 鉴权失败: 1, 异常: 2, 未配置: 3, OK: 4 };
results.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.name.localeCompare(b.name));

console.log('┌─ 巡检结果 ' + '─'.repeat(64));
for (const r of results) {
  console.log(`│ ${ICON[r.verdict] || '  '} [${r.verdict}] ${r.name}`);
  console.log(`│      ${r.keyName} = ${r.masked}`);
  console.log(`│      ${r.detail}${r.extra ? '  ' + r.extra : ''}`);
}
console.log('└' + '─'.repeat(74));

const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
console.log('\n汇总:' + Object.entries(tally).map(([k, v]) => `${ICON[k] || ''}${k} ${v}`).join('  |  '));
const bad = results.filter((r) => r.verdict === '欠费' || r.verdict === '鉴权失败' || r.verdict === '异常');
if (bad.length) {
  console.log('\n需处理(' + bad.length + '):');
  for (const r of bad) console.log(`  · ${r.name} — ${r.verdict} — ${r.detail}`);
} else {
  console.log('\n无欠费/异常项。');
}
