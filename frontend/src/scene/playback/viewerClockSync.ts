// 统一回放面板的跨视图时钟镜像（2026-11-19 用户要求：2D/3D 进度同步）。
//
// 2D（BattlePlayback 的 usePlaybackClock）与 3D（playbackScene 的 store.time）各自
// 拥有唯一时钟；统一面板同一时刻只显示一个 pane，因此同步只需要「切换时把旧 pane 的
// 当前位置/播放状态/倍速交给新 pane」。两个 pane 的懒加载 wrapper 不会向模板 ref 转发
// 子组件 expose（defineLazyModule 的稳定 wrapper 只渲染 async 代），所以用这个模块级
// 镜像做唯一交接点：pane 只写、工作台只在切换时读。
//
// 写入不驱动任何 UI（没有组件依赖这些值做渲染），60fps 的 2D 时钟也不会触发上层
// VDOM patch；相同值 / 差值 < 50ms 的重复写入直接跳过。
import { reactive } from 'vue'

export type ViewerMode = '2d' | '3d'

export interface ViewerClock {
  /** 战斗相对秒（0 = 开战）：2D 的 currentTime 原生就是它；3D 发布 store.time − store.startTime。 */
  time: number
  playing: boolean
  /** 该视图是否已有可用的回放数据；待开播 / 未加载的 3D 不得把 0 当作同步源。 */
  ready: boolean
  /** canonical 战斗起点（原始时钟秒）：3D seekTime 用原始秒，2D seekTo 用相对秒，靠它换算。 */
  startRaw: number
  /** 播放倍速：两条共用进度条必须显示同一个倍速。 */
  speed: number
}

export const viewerClocks = reactive<Record<ViewerMode, ViewerClock>>({
  '2d': { time: 0, playing: false, ready: false, startRaw: 0, speed: 1 },
  '3d': { time: 0, playing: false, ready: false, startRaw: 0, speed: 1 },
})

/** pane 时钟发布（time = 战斗相对秒；mode 由 pane 自己声明；非法值忽略，保持上一个有效值）。 */
export function publishViewerClock(mode: ViewerMode, time: number, playing: boolean, ready: boolean, startRaw: number, speed: number) {
  if (!Number.isFinite(time) || !Number.isFinite(startRaw) || !Number.isFinite(speed)) return
  const slot = viewerClocks[mode]
  if (slot.ready === ready && slot.playing === playing && slot.startRaw === startRaw
    && slot.speed === speed && Math.abs(slot.time - time) < 0.05) return
  slot.time = time
  slot.playing = playing
  slot.ready = ready
  slot.startRaw = startRaw
  slot.speed = speed
}

// `?debug` 诊断口（与场景 __grass / __pbPane 同口径）：只在 dev + 显式 query 下挂 window。
if (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  ;(window as Window & { __viewerClocks?: typeof viewerClocks }).__viewerClocks = viewerClocks
}

/** 换回放：两个视图的位置都作废（与 pendingSeek 的清理同一时机）。 */
export function resetViewerClocks() {
  for (const slot of Object.values(viewerClocks)) {
    slot.time = 0
    slot.playing = false
    slot.ready = false
    slot.startRaw = 0
    slot.speed = 1
  }
}
