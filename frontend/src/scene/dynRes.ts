/**
 * 动态分辨率控制器（?dynres=1 显式开启；纯函数状态机，单测锁定）。
 *
 * 目标：中低端 GPU 上把帧耗时压回预算内——持续超预算（帧时间滚动均值
 * > downMs）按步长降 renderer pixel ratio，持续有余量（均值 < upMs）按步长
 * 升回档位上限。迟滞（downMs > upMs）+ 冷却帧防止在阈值附近振荡。
 *
 * 契约：调用方只喂**实际渲染帧**的 dt（空闲帧不喂——暂停/脏帧门控跳过的帧
 * 不代表 GPU 负载）；返回新 DPR 仅在发生调整时，调用方负责 setPixelRatio +
 * 重设画布尺寸。ceilDpr ≤ floorDpr 时本控制器无调整空间（调用方应跳过装配）。
 */
export function createDynRes({
  ceilDpr,
  floorDpr = 1,
  step = 0.25,
  downMs = 22,        // ≈45fps 以下视为超预算
  upMs = 17,          // ≈60fps 即视为有余量。必须 > 16.7ms（60Hz VSync 帧间隔）：
                      // 调用方喂的是 rAF 帧间隔而非渲染耗时——真机上即使渲染只花
                      // 几毫秒，帧间隔也被 VSync 钳在 16.7ms，恢复阈值低于它 =
                      // 降档后永远回不去（评审复现：60Hz 下 2000 帧停在 DPR 1）
  windowN = 45,       // 滚动均值窗口（≈0.75s @60fps）
  cooldownFrames = 60,// 一次调整后至少隔多少渲染帧才允许下一次（≈1s @60fps）
} = {}) {
  if (!(ceilDpr > floorDpr)) throw new Error(`dynRes: 无调整空间 (ceil ${ceilDpr} ≤ floor ${floorDpr})`)
  let dpr = ceilDpr
  const window = []
  let cooldown = 0
  return {
    dpr: () => dpr,
    /** 喂一帧的 dt(ms)；返回调整后的 DPR（未调整返回 null）。 */
    frame(dtMs) {
      window.push(dtMs)
      if (window.length > windowN) window.shift()
      if (cooldown > 0) { cooldown -= 1; return null }
      if (window.length < windowN) return null      // 窗口未满：不基于部分数据决策
      const mean = window.reduce((a, b) => a + b, 0) / window.length
      if (mean > downMs && dpr > floorDpr) {
        dpr = Math.max(floorDpr, Math.round((dpr - step) * 100) / 100)
      } else if (mean < upMs && dpr < ceilDpr) {
        dpr = Math.min(ceilDpr, Math.round((dpr + step) * 100) / 100)
      } else {
        return null
      }
      window.length = 0                             // 调整后清窗：旧帧是旧分辨率下的测量
      cooldown = cooldownFrames
      return dpr
    },
  }
}
