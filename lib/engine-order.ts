/**
 * 视频引擎链序解析(v12.156.0)—— 主管线与单镜补渲共用的纯函数。
 *
 * 优先级:用户显式 provider > env `VIDEO_ENGINE_ORDER`(逗号序,如 "kling,minimax,veo")> 默认 Veo 打头。
 * 动机:MiniMax 刷新额度只够几镜、Kling 已充值 —— 主力引擎该由运营者一行 env 决定,
 * 而不是改代码。未知引擎名忽略;结果只含可用引擎;永不为空(除非 available 为空)。
 */
export type VideoEngineName = 'veo' | 'minimax' | 'kling';

const DEFAULT_ORDER: VideoEngineName[] = ['veo', 'minimax', 'kling'];

export function parseEngineOrderEnv(raw: string | undefined | null): VideoEngineName[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is VideoEngineName => s === 'veo' || s === 'minimax' || s === 'kling');
}

/**
 * 解析最终链序:
 * @param provider  用户显式选择('veo'/'minimax'/'kling'/其他别名忽略)
 * @param available 当前可用引擎(有 key/服务实例的)
 * @param envOrder  parseEngineOrderEnv 的结果(调用方读 env 注入,保持纯函数)
 */
export function resolveEngineOrder(
  provider: string | undefined | null,
  available: VideoEngineName[],
  envOrder: VideoEngineName[] = [],
): VideoEngineName[] {
  const has = (e: VideoEngineName) => available.includes(e);
  const dedupe = (arr: VideoEngineName[]) => [...new Set(arr)].filter(has);

  const p = (provider || '').toLowerCase();
  if ((p === 'minimax' || p === 'veo' || p === 'kling') && has(p as VideoEngineName)) {
    // 显式选择打头,其余按 env 序(无 env 按默认)补位兜底
    const rest = (envOrder.length ? envOrder : DEFAULT_ORDER).filter((e) => e !== p);
    return dedupe([p as VideoEngineName, ...rest, ...DEFAULT_ORDER]);
  }
  if (envOrder.length && envOrder.some(has)) {
    return dedupe([...envOrder, ...DEFAULT_ORDER]);
  }
  return dedupe(DEFAULT_ORDER);
}
