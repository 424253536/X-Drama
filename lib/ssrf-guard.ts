/**
 * v12.234 — 统一 SSRF 出站白/黑名单守卫。
 *
 * 背景(二轮对抗复检 · 独立安全分析):此前有两条互不相干的出站 fetch 路径,各写各的防护:
 *   · `app/api/serve-file?proxy=` —— 一条正则拦 `127./10./192.168./172.16-31./localhost/0.0.0.0`;
 *   · `lib/asset-storage.ts persistAsset()` —— **完全没有**任何 IP 过滤,来者不拒。
 *
 * 那条正则漏掉的正是最值钱的目标:
 *   · `169.254.169.254` —— AWS/GCP/Azure 实例元数据服务(IMDS),能直接读 IAM 临时凭证;
 *   · IPv6 回环 `[::1]` 与 IPv6 私网 `fc00::/7`、链路本地 `fe80::/10`;
 *   · 十六进制/十进制/八进制编码的 IPv4(`0x7f000001`、`2130706433`、`0177.0.0.1`);
 *   · `metadata.google.internal` 这类**解析到内网的域名**(正则只看字面量,看不见 DNS 结果)。
 *
 * 所以这里做两层:
 *   1. **字面量层**:归一化主机名(去括号、解码各种进制),对已知内网段直接拒;
 *   2. **DNS 层**:真去解析域名,拿到的每个 A/AAAA 地址都过一遍同一套判定 ——
 *      这层才是拦 DNS-rebinding / 内网别名域名的关键,只做字面量匹配等于没做。
 *
 * 注意:DNS 解析与真正 fetch 之间仍有 TOCTOU 窗口(rebinding 可在两次解析间换 IP)。
 * 彻底堵需要在 socket 层校验对端地址(undici 的 connect 钩子),那是更大的改造;
 * 当前实现把门槛从「零成本」提到「需要精确控制 DNS TTL 的竞态」,并在此如实标注局限。
 */
import dns from 'dns/promises';
import net from 'net';

/** 判定一个**已是 IP 字面量**的字符串是否属于不可出站的内网/保留段。 */
export function isBlockedIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 10) return true;                      // 10/8 私网
    if (a === 127) return true;                     // 回环
    if (a === 169 && b === 254) return true;        // 链路本地 —— 含 169.254.169.254 云 IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 私网
    if (a === 192 && b === 168) return true;        // 192.168/16 私网
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 192 && b === 0) return true;          // 192.0.0/24 IETF 协议保留
    if (a >= 224) return true;                      // 组播 224/4 + 保留 240/4
    return false;
  }

  if (net.isIPv6(v)) {
    if (v === '::1' || v === '::') return true;                 // 回环 / 未指定
    if (/^fe[89ab]/.test(v)) return true;                       // fe80::/10 链路本地
    if (/^f[cd]/.test(v)) return true;                          // fc00::/7 唯一本地
    // IPv4 映射地址 ::ffff:127.0.0.1 —— 取出内嵌 v4 递归判定,否则等于开了后门
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    return false;
  }

  return false; // 不是 IP 字面量 → 交给调用方走 DNS 那层
}

/**
 * 把各种「花式写法」的主机名归一化成点分十进制 IPv4;不是 IPv4 变体则原样返回。
 * 攻击者常用 `http://0x7f000001/`、`http://2130706433/`、`http://0177.0.0.1/` 绕过字面量正则。
 */
export function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  // 纯十进制整数形式:2130706433 → 127.0.0.1
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
  }
  // 十六进制整体形式:0x7f000001
  if (/^0x[0-9a-f]+$/.test(h)) {
    const n = parseInt(h, 16);
    if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
  }
  // 逐段进制混写:0177.0.0.1(八进制段)/ 0x7f.0.0.1(十六进制段)
  const parts = h.split('.');
  if (parts.length === 4 && parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|\d+)$/.test(p))) {
    const nums = parts.map((p) =>
      /^0x/.test(p) ? parseInt(p, 16) : /^0[0-7]+$/.test(p) ? parseInt(p, 8) : Number(p),
    );
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return nums.join('.');
  }
  return h;
}

export type SsrfVerdict = { ok: true } | { ok: false; reason: string };

/**
 * 出站 URL 安全校验:协议 → 主机字面量 → DNS 解析结果,三道都过才放行。
 *
 * `allowPrivate` 供本地开发/自测显式开(默认关)。生产**永远**不允许开:
 * 这类开关一旦能在生产生效,等于把整个防线做成了一个环境变量。
 */
export async function assertOutboundUrlSafe(rawUrl: string): Promise<SsrfVerdict> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL 解析失败' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `不允许的协议 ${u.protocol}(仅 http/https)` };
  }

  const allowPrivate =
    process.env.SSRF_ALLOW_PRIVATE === '1' && process.env.NODE_ENV !== 'production';
  if (allowPrivate) return { ok: true };

  const host = normalizeHost(u.hostname);

  // 明确的本机别名 —— 这些不一定解析成 IP 字面量,但语义就是「打我自己」
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: `内网主机名被拒:${u.hostname}` };
  }
  // 云厂商元数据域名(GCP 的 metadata.google.internal 已被上面 .internal 覆盖,这里补其余)
  if (host === 'metadata' || host === 'instance-data') {
    return { ok: false, reason: `云元数据主机名被拒:${u.hostname}` };
  }

  if (net.isIP(host)) {
    return isBlockedIp(host)
      ? { ok: false, reason: `内网/保留地址被拒:${host}` }
      : { ok: true };
  }

  // 域名 → 必须真解析。解析不出来就拒(宁可误杀,也不放一个解析行为不明的目标出去)
  let addrs: string[];
  try {
    const res = await dns.lookup(host, { all: true, verbatim: true });
    addrs = res.map((r) => r.address);
  } catch (e) {
    return { ok: false, reason: `DNS 解析失败:${e instanceof Error ? e.message : 'unknown'}` };
  }
  if (addrs.length === 0) return { ok: false, reason: 'DNS 无解析结果' };

  // 任一解析地址落在内网就整体拒 —— 多 A 记录里混一个 127.0.0.1 是经典绕过手法
  const bad = addrs.find((a) => isBlockedIp(a));
  if (bad) return { ok: false, reason: `域名 ${u.hostname} 解析到内网地址 ${bad}` };

  return { ok: true };
}

/**
 * v12.235 —— 带 SSRF 校验的 fetch,**逐跳重验重定向**。
 *
 * 上一版(v12.234)刚写完 `assertOutboundUrlSafe` 就自查出一个致命缺口:
 * 它只校验**初始 URL**,而 Node/undici 的 `fetch` 默认 `redirect: 'follow'` ——
 * 攻击者只要给一个自己控制的公网地址,让它 302 到 `http://169.254.169.254/...`,
 * 守卫全程放行,云 IAM 凭证照样被代理回来。**整道防线等于没做。**
 *
 * 又是同一个病:写了「解析层」的守卫,却没跟到「真正发请求」的消费方。
 * 所以这里不再让调用方自己 fetch,而是提供唯一入口:redirect 设 manual,
 * 每跳的 Location 都重新过一遍 assertOutboundUrlSafe,跳数封顶。
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let url = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const verdict = await assertOutboundUrlSafe(url);
    if (!verdict.ok) {
      throw new Error(
        hop === 0
          ? `SSRF 拦截:${verdict.reason}`
          : `SSRF 拦截(第 ${hop} 跳重定向):${verdict.reason}`,
      );
    }

    const resp = await fetch(url, { ...init, redirect: 'manual' });
    if (resp.status < 300 || resp.status >= 400) return resp;

    const loc = resp.headers.get('location');
    if (!loc) return resp; // 3xx 但没给 Location —— 原样交回,由调用方处理
    // 相对跳转要按当前 URL 解析,否则 `/latest/meta-data` 这种相对路径会被漏判
    url = new URL(loc, url).toString();
  }
  throw new Error(`SSRF 拦截:重定向超过 ${maxRedirects} 跳`);
}
