// 2D/3D 视图切换的播放时钟交接 + 事件流 seek 通道（从 useReplayOrchestration 拆出，行数预算 500）。
//
// 交接语义：切换前读旧 pane 最后发布的战斗相对秒与播放态/倍速，切换后向新 pane 发一次性 seek；
// 面板按钮与 URL 变化（浏览器前进/后退/深链）共用同一份逻辑——URL 是来源，
// applyCapabilityFromRoute 绝不反向 navigate（避免 watcher ↔ push 循环）。
import { nextTick, ref, watch } from 'vue'
import { resetViewerClocks, viewerClocks } from '../scene/playback/viewerClockSync.js'

export interface ViewerSeekRequest { id: number; sec: number; playing: boolean; speed: number }
export interface Pending3dSeek { id: number; sec: number; playing?: boolean; speed?: number }

type ViewerMode = '2d' | '3d'
/** 能力键 → 实际回放 pane 模式；非回放页（data/shots/ai）返回 null——
 *  它们不是「停在 2D」，从这些页返回时不得把隐藏 2D 的旧时钟投给保活的目标 pane。 */
const VIEWER_MODE_BY_CAPABILITY: Record<string, ViewerMode> = { playback: '2d', '3d': '3d', events: '2d' }
function viewerModeOf(capability: string): ViewerMode | null {
  return VIEWER_MODE_BY_CAPABILITY[capability] ?? null
}

export function useReplayViewerClockBridge(deps: {
  /** 当前面板显示哪个 pane（activeCapability 的派生）。 */
  viewerMode: { readonly value: ViewerMode }
  /** 当前内部能力键（切换前判定是否为真实的 2D/3D 迁移）。 */
  activeCapability: { readonly value: string }
  /** 切换内部能力（workspace tab + feature 门禁）；navigate=是否同步 URL。 */
  switchCapability: (key: string, navigate: boolean) => void
}) {
  /** AI 复盘关键回合 →「在 2D 中查看」：数字通道（BattlePlaybackPanel.seekTo 监听变化）。 */
  const playbackSeek = ref<number | null>(null)
  /** 2D 的「切换同步」请求（含播放状态/倍速）：一次性消费，与数字通道分开。 */
  const playbackSeekRequest = ref<ViewerSeekRequest | null>(null)
  /** 3D 的一次性 seek 请求：id 单调递增——按 id 只消费一次，切回 3D 不得重放旧请求。 */
  const pending3dSeek = ref<Pending3dSeek | null>(null)
  let seekSeq = 0

  /** 切换前的交接源；ready=false（如 3D 待开播）返回 null——不得用 0 覆盖真实进度。 */
  interface Handoff { elapsed: number; playing: boolean; speed: number; startRaw: number }
  function handoffSourceOf(mode: ViewerMode): Handoff | null {
    const prev = viewerClocks[mode]
    if (!prev.ready) return null
    return { elapsed: Math.max(0, prev.time), playing: prev.playing, speed: prev.speed, startRaw: prev.startRaw }
  }
  /** 把交接源投给目标视图：3D seekTime 收原始秒（目标未挂载时用源视图 startRaw 换算），
   *  2D 收战斗相对秒；两边的播放状态与倍速一起交接。 */
  function pushHandoff(mode: ViewerMode, src: Handoff): void {
    if (mode === '3d') {
      const target = viewerClocks['3d']
      pending3dSeek.value = {
        id: ++seekSeq, sec: src.elapsed + (target.startRaw || src.startRaw),
        playing: src.playing, speed: src.speed,
      }
      return
    }
    playbackSeekRequest.value = { id: ++seekSeq, sec: src.elapsed, playing: src.playing, speed: src.speed }
  }

  /** 面板 2D/3D 切换 → 内部能力 → URL（agent-replay / battle-playback）。 */
  function setViewerMode(mode: ViewerMode): void {
    if (mode === deps.viewerMode.value) return
    const src = handoffSourceOf(deps.viewerMode.value)
    deps.switchCapability(mode === '3d' ? '3d' : 'playback', true)
    if (src) pushHandoff(mode, src)
  }
  /** 浏览器前进/后退（或深链）切能力：与面板按钮共用同一份交接，不反向 navigate。 */
  function applyCapabilityFromRoute(key: string): void {
    const next = viewerModeOf(key)
    const prev = viewerModeOf(deps.activeCapability.value)
    // 只在来源与目标都是回放 pane、且实际模式不同（2D↔3D）时交接：
    // 3D→数据/射击/AI→Back 保留目标 pane 自己的时钟；events↔playback 同属 2D 不发 seek。
    const src = next && prev && prev !== next ? handoffSourceOf(prev) : null
    deps.switchCapability(key, false)
    if (next && src) pushHandoff(next, src)
  }
  /** 2D 事件跳转：事件原始秒 → 战斗相对秒（减 canonical 开战原点），一次性下发。 */
  function apply2dEventSeek(elapsed: number): void {
    playbackSeek.value = null
    nextTick(() => { playbackSeek.value = elapsed })
  }
  /** 2D canonical 尚未发布 startRaw 时暂存原始事件时间：此时镜像里的 0 不是开战原点，
   *  直接换算会把「原始 60s / 开战 30s」跳成战斗第 60s 而不是第 30s。 */
  let pending2dRawSeek: number | null = null
  watch(() => viewerClocks['2d'].ready, (ready) => {
    if (!ready || pending2dRawSeek == null) return
    const raw = pending2dRawSeek
    pending2dRawSeek = null
    apply2dEventSeek(Math.max(0, raw - (viewerClocks['2d'].startRaw || 0)))
  })
  /** 信息流行点击：事件时间 t 是原始时钟秒；2D 的 seekTo 收战斗相对秒，3D 的 seekTime 收原始秒。 */
  function onEventSeek(sec: number): void {
    if (!Number.isFinite(sec)) return
    if (deps.viewerMode.value === '3d') {
      pending3dSeek.value = { id: ++seekSeq, sec }
      return
    }
    const clock = viewerClocks['2d']
    if (!clock.ready) { pending2dRawSeek = sec; return }
    apply2dEventSeek(Math.max(0, sec - (clock.startRaw || 0)))
  }
  /** 换回放：旧场的 seek 请求与时钟镜像一并作废。 */
  function resetViewerClockBridge(): void {
    pending3dSeek.value = null
    playbackSeekRequest.value = null
    pending2dRawSeek = null
    resetViewerClocks()
  }

  return {
    playbackSeek, playbackSeekRequest, pending3dSeek,
    setViewerMode, applyCapabilityFromRoute, onEventSeek, resetViewerClockBridge,
  }
}