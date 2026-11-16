// 地形 LOD 换装后的最终姿态兜底（Issue #728 Workstream B 评审 F3/F4）。
//
// 调度器在途时忽略新请求，换装的是「请求发出时」的相机快照。若相机在构建期间继续移动、
// 并在结果返回前停下，宿主此后没有播放、没有相机变化、也没有脏帧——`animate()` 的 `!busy`
// 分支早于 `maybeRebuildTerrainLod()` 返回，节流窗内到达的那一帧也不会提交。结果是最终
// 相机姿态永远得不到判定，旧的粗网格停在屏幕上。
//
// 这里只做一件事：换装方发现「当前相机仍不符合已换装快照」时，在 120 ms 节流到期时唤醒
// 宿主一帧（`invalidate()` 置脏），让当前姿态进入下一次判定；宿主恢复出帧后本计时器即可取消。

import { TERRAIN_LOD_MIN_INTERVAL_MS } from '../terrainMesh.js'

export interface TerrainLodWake {
  /** 距换装已过去 `sinceSwapMs`：节流到期时调用一次 `invalidate()`（重复调用会重置计时）。 */
  scheduleElapsed(sinceSwapMs: number): void
  /** 取消待触发的唤醒（换装已匹配当前姿态 / 同步回退已提交 / 会话结束）。 */
  cancel(): void
  readonly pending: boolean
}

interface WakeTimers {
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function createTerrainLodWake(
  invalidate: () => void,
  destroyed: () => boolean,
  timers: WakeTimers = {},
): TerrainLodWake {
  const setTimer = timers.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = timers.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let handle: unknown = null

  function cancel() {
    if (handle === null) return
    clearTimer(handle)
    handle = null
  }

  return {
    scheduleElapsed(sinceSwapMs) {
      cancel()
      const delay = Math.max(0, TERRAIN_LOD_MIN_INTERVAL_MS - sinceSwapMs)
      handle = setTimer(() => {
        handle = null
        if (!destroyed()) invalidate()
      }, delay)
    },
    cancel,
    get pending() { return handle !== null },
  }
}
