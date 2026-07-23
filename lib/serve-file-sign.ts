/**
 * v12.236(第三轮对抗复检 · serve-file `?path=` 跨用户 IDOR)。
 *
 * 问题:`?path=` 模式此前只做「登录 + 目录白名单」——任何**已登录**用户只要知道另一个用户
 * 成片的绝对路径(成片名是 `final-${Date.now()}.mp4`,时间戳可从 SSE 事件 / 网络日志推算),
 * 带自己的 cookie 就能下载他人的成片 / 封面 / TTS 音频。路径本身不含 projectId,无从反查归属。
 *
 * 解法:把 `?path=` 变成**签名能力 URL**(类比 S3 presigned URL)——
 * 服务端签发时用 `signServeFilePath()` 附一段 HMAC,serve-file 读取时验签,伪造不了签名就进不来。
 * 这样「任意登录用户构造任意路径」被降级为「只能访问服务端真的签发过的 URL」,
 * 与 `?key=`(内容寻址、不可枚举的能力 URL)同一安全模型。
 *
 * 兼容性:所有**解析** `?path=` 的消费方(video-composer / last-frame-extractor / cameo-vision 等)
 * 都用 `new URL().searchParams.get('path')` 取值,天然忽略多出来的 `&sig=`,不受影响。
 * 无签名的历史 URL 会被拒(403)——本地媒体路径 URL 本就易随文件清理失效,持久成片走 `?key=`。
 */
import crypto from 'crypto';

function serveFileSecret(): string {
  // 复用 JWT_SECRET(生产必设),避免再引一个必配项;可用 SERVE_FILE_SECRET 单独覆盖。
  return process.env.SERVE_FILE_SECRET || process.env.JWT_SECRET || 'dev-insecure-serve-file-secret';
}

function computeSig(absPath: string): string {
  return crypto.createHmac('sha256', serveFileSecret()).update(absPath).digest('hex').slice(0, 32);
}

/** 生成签名版 serve-file URL。所有服务端拼 `?path=` 的地方都应走这里(而非手拼)。 */
export function serveFilePathUrl(absPath: string): string {
  return `/api/serve-file?path=${encodeURIComponent(absPath)}&sig=${computeSig(absPath)}`;
}

/** 校验 `?path=` 的签名(timing-safe)。缺签名或不匹配一律 false。 */
export function verifyServeFileSig(absPath: string, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = computeSig(absPath);
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
