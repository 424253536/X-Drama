/**
 * 「消费方门禁」契约表 —— v12.240。
 *
 * ## 为什么有这个文件
 *
 * v12.218→v12.239 二十多个版本的安全加固里,**同一个病犯了五次**:
 *
 * | 版本 | 我改了(判定/解析层) | 却漏了(消费方) |
 * |---|---|---|
 * | v12.233 | `findCjkFont()` 改开源优先 | `subtitle-burn` 预设、`video-composer` 兜底、`cover-title-burn` 顺序全是硬编码 |
 * | v12.235 | 写了 `assertOutboundUrlSafe` | `fetch` 默认跟随 302,守卫只看初始 URL |
 * | v12.237 | serve-file HTTP 端点验签 | `persistAsset`/`serveFileToLocalPath` 自己解析 `?path=` 直接读盘 |
 * | v12.238 | 把 provider 注册进 registry | plugin chain 默认 off,`generate()` 一次都没被调用 |
 * | v12.239 | 补 IPv6 判定 | 又漏三类隧道写法(NAT64 local-use / Teredo / ISATAP) |
 *
 * 每一次都是**人肉对抗复检**才发现的。复检很贵(五轮 ~340 万 token),而且它只能发现
 * 「已经发生的」——下一次新代码照样可能再犯。所以把这类不变量固化成**入库门禁**:
 * 建立唯一入口,禁止绕过它的写法,新增例外必须显式登记理由。
 *
 * ## 设计原则(每一条都是踩出来的)
 *
 * 1. **每条契约必须对应真实事故** —— 空泛的最佳实践不进表,否则噪音淹没信号。
 * 2. **先剥注释再匹配** —— v12.234 和 v12.239 各踩过一次:解释病根的注释里引用了同一串字符,
 *    把自己的锁弄红了。「把问题讲清楚」不该让门禁报警。
 * 3. **白名单必须带 reason** —— 加白名单 = 显式声明「我知道我在绕过,理由是 X」。
 *    没有理由的白名单条目本身就是违规。
 * 4. **门禁只做静态能做的** —— 有些病(判定只认一种书写形式、注册了但没被调用)静态扫不出来,
 *    这些在 `runtimeGateNotes` 里注明,靠专门的运行时测试兜,不假装门禁覆盖了它们。
 */

export interface GateContract {
  /** 稳定 id(违规报告里显示,白名单按它归类)。 */
  id: string;
  /** 一句话说清这条契约要求什么。 */
  rule: string;
  /** 对应的真实事故 —— 没有事故就不该有契约。 */
  incident: string;
  /** 唯一入口(允许做这件事的地方);仅用于报错信息里的指引。 */
  entry: string;
  /** 匹配「绕过写法」的正则(在**剥掉注释与字符串字面量之后**的代码上跑)。 */
  forbid: RegExp;
  /** 扫描范围:相对仓库根的目录前缀。 */
  scope: string[];
  /** 允许的例外 —— 每条都必须写清 why。 */
  allow: Array<{ file: string; why: string }>;
}

/**
 * 静态扫不出来、必须靠运行时测试守的病 —— 在这里如实登记,
 * 避免「门禁绿了 = 这类问题不存在」的错觉(那正是 v12.238 的假绿)。
 */
export const RUNTIME_ONLY_GAPS: Array<{ gap: string; incident: string; guardedBy: string }> = [
  {
    gap: '判定函数只认某一种书写形式(同一语义的其他写法绕过)',
    incident: 'v12.236 `::ffff:7f00:1` 与 `::ffff:127.0.0.1` 同址,正则只认后者;v12.237/239 又漏 6to4/NAT64/Teredo/ISATAP',
    guardedBy: 'tests/v12-236|237|239 的变体穷举用例 —— 新增判定分支时必须同步补「同语义不同写法」的表驱动用例',
  },
  {
    gap: '组件注册了但从未被执行(链路开关默认关)',
    incident: 'v12.238 两个 image provider 注册进 registry 且排序正确,但 plugin chain 默认 off → generate() 一次没跑',
    guardedBy: 'tests/v12-239-plugin-actually-runs.test.ts —— 断言的是 generate() **被调用**,不是「被选中」',
  },
  {
    gap: '新付费路径未接入成本记账(记账条件与新返回形态不匹配)',
    incident: 'v12.239 两个 provider 返 data: URI,而记账正则只匹配 http(s)|/api/serve-file → 完全不记账',
    guardedBy: 'tests/v12-239-recheck5 的记账条件断言 + 本文件 cost-log-shape 契约(只能查形态,查不了「有没有真记」)',
  },
];

export const CONTRACTS: GateContract[] = [
  {
    id: 'outbound-fetch-must-use-safeFetch',
    rule: '任何服务端出站 HTTP 必须走 lib/ssrf-guard 的 safeFetch(它逐跳重验重定向),禁止裸 fetch(',
    incident:
      'v12.235:assertOutboundUrlSafe 只校验初始 URL,而 fetch 默认 redirect:follow —— ' +
      '攻击者用自己控制的公网地址 302 到 169.254.169.254,整道 SSRF 防线被完整绕过。',
    entry: 'safeFetch(url, init) from lib/ssrf-guard',
    /**
     * 只拦「**URL 来自变量**」的 fetch,放行「打固定端点」的 fetch。
     *
     * 第一版写的是 `/(?<![\w.])fetch\s*\(/` —— 结果一跑 **60 处命中**,里面绝大多数是
     * `fetch(\`${base}/chat/completions\`)` 这类打配置好的第三方端点,URL 根本不来自请求。
     * 那种门禁的下场是可预见的:几十条噪音 → 大家习惯性往白名单里塞 → 门禁彻底失效。
     * (这正是本文件设计原则里担心的「白名单腐化」,我自己第一版就掉进去了。)
     *
     * 真正的风险面是「拿一个**变量**当 URL 去 fetch」——那个变量可能一路追溯到请求体。
     * 所以判据改为:`fetch(` 后**直接跟标识符**(而非反引号/引号字面量)。
     *   · `fetch(url, {...})` / `fetch(sourceUrl)` / `fetch(proxyUrl)` → 拦
     *   · `fetch(\`${API_BASE}/x\`)` / `fetch('https://api.x/y')`     → 放行
     */
    forbid: /(?<![\w.])fetch\s*\(\s*[A-Za-z_$][\w$]*\s*[,)]/,
    scope: ['lib/', 'services/', 'app/api/'],
    allow: [
      { file: 'lib/ssrf-guard.ts', why: 'safeFetch 的实现本体,它必须调裸 fetch' },
      { file: 'lib/image-providers/openrouter-image.ts', why: 'v12.96 既有档,固定打 openrouter.ai 常量域名,不接受用户 URL' },
      { file: 'lib/llm-client.ts', why: 'LLM 网关地址来自 env 配置而非请求输入,且不跟随到用户可控目标' },
    ],
  },
  {
    id: 'servefile-url-must-be-signed',
    rule: '生成 /api/serve-file?path= 链接必须走 serveFilePathUrl()(带 HMAC 签名),禁止手拼',
    incident:
      'v12.236:?path= 只做「登录 + 目录白名单」,成片名是 final-<时间戳>.mp4 —— ' +
      '任何登录用户拿到路径即可下载他人成片。改为签名能力 URL 后,手拼的一律无效。',
    entry: 'serveFilePathUrl(absPath) from lib/serve-file-sign',
    forbid: /\/api\/serve-file\?path=\$\{encodeURIComponent\(/,
    scope: ['lib/', 'services/', 'app/'],
    allow: [
      { file: 'lib/serve-file-sign.ts', why: '签名函数本体,唯一合法的手拼点' },
    ],
  },
  {
    id: 'servefile-param-must-be-verified',
    rule: '解析 ?path= 取本地路径后读盘,必须经 resolveVerifiedServeFilePath()(验签 + 白名单)',
    incident:
      'v12.237:v12.236 只给 HTTP 端点验签,漏了 persistAsset / serveFileToLocalPath 两条**服务端本地读盘路径** —— ' +
      'cameo/pull-sheet/video-anchor 把用户 body 的 ?path= 喂进来即可读任意文件。签了前门,漏了侧门。',
    entry: 'resolveVerifiedServeFilePath(url) from lib/serve-file-sign',
    // 手工从 serve-file URL 里抠 path 参数 = 绕过验签
    forbid: /searchParams\.get\(\s*['"]path['"]\s*\)|URLSearchParams\([^)]*\)\.get\(\s*['"]path['"]\s*\)/,
    scope: ['lib/', 'services/', 'app/api/'],
    allow: [
      { file: 'lib/serve-file-sign.ts', why: 'resolveVerifiedServeFilePath 的实现本体 —— 它必须先取出 path 参数才能验签' },
      { file: 'app/api/serve-file/route.ts', why: 'serve-file 路由自身:取参后立刻 verifyServeFileSig' },
      { file: 'services/video-composer.ts', why: 'downloadFile 只处理**本进程刚生成**的内部 URL,不接受请求体输入' },
      { file: 'app/api/projects/[id]/audio-check/route.ts', why: '只对已通过 requireProjectAccess 的本项目资产做 ffprobe' },
    ],
  },
  {
    id: 'cjk-font-must-be-resolved',
    rule: 'CJK 字体一律经 findCjkFont() / resolveCjkFontName() 解析,禁止硬编码系统专有字体路径或字体名',
    incident:
      'v12.233 只改了解析函数就宣布「字体 EULA 已合规」,而真正把字形烧进成片的三条路径 ' +
      '(video-composer 两处硬编码、subtitle-burn 四个平台预设、cover-title-burn 候选顺序)原封不动;' +
      'v12.239 又发现 fontForLanguage 的 ko/ja 分支仍返回 Apple 专有字体名。',
    entry: 'findCjkFont() / resolveCjkFontName() from lib/text-control、lib/subtitle-burn',
    forbid: /['"`][^'"`]*\/System\/Library\/Fonts\/[^'"`]*['"`]|['"`](PingFang SC|Hiragino Sans|Apple SD Gothic Neo|STHeiti[^'"`]*)['"`]/,
    scope: ['lib/', 'services/', 'app/'],
    allow: [
      { file: 'lib/text-control.ts', why: '字体候选表本体:系统字体作为最后兜底登记在此,并标注 EULA 限制' },
      { file: 'lib/cover-title-burn.ts', why: '封面候选表本体:开源优先、系统字体列在末位兜底' },
    ],
  },
  {
    id: 'external-io-must-have-timeout',
    rule: '出站请求必须带超时(signal),否则慢速上游可无限占用连接',
    incident:
      'v12.239:gemini-image 的参考图拉取 safeFetch(url, {}) 传空 init,而外层 120s 只覆盖最终那次调用 —— ' +
      '慢速流(1KB/s 吐 12MB)× 3 并发能把连接挂住数小时。',
    entry: 'AbortSignal.timeout(ms) 或 AbortController',
    // 空 init 的 safeFetch 调用 = 没有超时
    forbid: /safeFetch\([^,)]+,\s*\{\s*\}\s*\)/,
    scope: ['lib/', 'services/', 'app/api/'],
    allow: [],
  },
  {
    id: 'sentinel-must-not-pass-writes',
    rule: "写 handler 里出现 = '__no_auth__' 时,同一 handler 内必须有真守卫",
    incident:
      'v12.234/236:身份解析失败后赋哨兵**然后继续执行** —— review-status 可 approve 任意项目、' +
      'save-template 可读任意项目元数据、global-assets 可匿名写入。哨兵的语义是「查空」,不是「无身份也放行」。',
    entry: 'requireUser / requireProjectAccess / guardPaidEndpoint',
    forbid: /=\s*['"]__no_auth__['"]/,
    scope: ['app/api/'],
    allow: [
      { file: 'lib/repos/pipeline-job-repo.ts', why: '仓储层用哨兵做「查不到就返空集」的安全默认,不是放行' },
    ],
  },
  {
    id: 'dangerous-env-switch-must-die-in-prod',
    rule: '能削弱安全的 env 开关,必须在 NODE_ENV=production 下强制失效',
    incident:
      'v12.222 PLAN_GATE_DISABLED 可在生产穿墙;v12.236 DEMO_ADMIN=1 让 demo 账号首次 seed 即 admin —— ' +
      '开发者把整份 env 拷到生产就把 admin 接口交给了公开凭据。「配错就等于不设防」的开关必须自己死掉。',
    entry: "if (... && process.env.NODE_ENV === 'production') 强制忽略并告警",
    // 这条不做正则拦截(写法太多),仅登记;实际检查在下面的 envSwitchAudit
    forbid: /(?!)/, // 永不匹配 —— 见 auditEnvSwitches
    scope: [],
    allow: [],
  },
];

/**
 * 需要「生产强制失效」的危险开关清单 —— 扫描器会检查每个开关所在文件里
 * 确实存在 production 门控。比正则拦截更准,也更好维护。
 */
export const DANGEROUS_ENV_SWITCHES: Array<{ name: string; file: string; why: string }> = [
  { name: 'PLAN_GATE_DISABLED', file: 'lib/plan-gate.ts', why: '关掉套餐门禁 = 免费用户可消费高价引擎(v12.222)' },
  { name: 'DEMO_ADMIN', file: 'lib/db.ts', why: 'demo 账号提权为 admin,而 demo 凭据是公开的(v12.236)' },
  { name: 'SSRF_ALLOW_PRIVATE', file: 'lib/ssrf-guard.ts', why: '放行内网出站 = SSRF 守卫整体失效(v12.234)' },
];
