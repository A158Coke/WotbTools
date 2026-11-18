import { getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'

/**
 * 2D / 3D 回放共用的播放传输行为（与 PlaybackTransport.vue 配套）。
 *
 * 不持有播放状态：时间与播放中标志的唯一 owner 仍是各自的播放器（2D 的 BattlePlayback、
 * 3D 的 playbackScene），这里只通过 adapter 读写，统一三件事：
 * - 速度档位 / 默认速度 / 跳秒步长；
 * - 拖动进度条：按下即暂停，松手时若原先在播放则自动继续；
 * - 键盘：空格 播放/暂停、←/→ ±5s、`,`/`.` 跳炮击、1–7/Shift+1–7 骑乘（后两者由面板
 *   经 adapter 接线，未接则这些键保持原样）；输入框 / 按钮聚焦时与播放器不可见时不响应。
 */
export const PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4, 8])
export const DEFAULT_PLAYBACK_SPEED = 1
export const PLAYBACK_STEP_SECONDS = 5

export function isPlaybackSpeed(value: unknown): boolean {
  return PLAYBACK_SPEEDS.includes(value as number)
}

/** 键盘事件落在可输入 / 可操作控件上时不劫持（空格要留给按钮和输入框本身） */
interface EventTargetLike {
  isContentEditable?: boolean
  tagName?: string
}

export function isInteractiveTarget(target: EventTargetLike | null | undefined): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName as string)
}

/**
 * @param {object} adapter
 * @param {() => boolean} adapter.isPlaying
 * @param {() => void} adapter.play
 * @param {() => void} adapter.pause
 * @param {(deltaSeconds: number) => void} adapter.step
 * @param {() => boolean} [adapter.isActive]  播放器当前是否可见 / 可交互（缺省视为可交互）
 * @param {() => boolean} [adapter.isReady]   时间轴是否已就绪（缺省视为就绪）
 * @param {() => boolean} [adapter.isAtEnd]   是否停在时间轴终点（缺省视为否）
 * @param {() => void} [adapter.restart]      回到时间轴起点（终点按播放时先调用）
 * @param {object} [options]
 * @param {boolean} [options.keyboard=true]   是否在组件生命周期内挂全局键盘监听
 */
/** usePlaybackTransport 的播放器 adapter（2D BattlePlayback / 3D playbackScene 各自实现）。 */
export interface PlaybackTransportAdapter {
  isPlaying: () => boolean
  play: () => void
  pause: () => void
  step: (deltaSeconds: number) => void
  /** 播放器当前是否可见 / 可交互（缺省视为可交互） */
  isActive?: () => boolean
  /** 时间轴是否已就绪（缺省视为就绪） */
  isReady?: () => boolean
  /** 是否停在时间轴终点（缺省视为否） */
  isAtEnd?: () => boolean
  /** 回到时间轴起点（终点按播放时先调用） */
  restart?: () => void
  /**
   * 跳炮击（blitzinfo 式）：direction=-1 上一发 / +1 下一发（以 shots[].t_fire 为序列）。
   * 缺省（2D 未接）= `,`/`.` 键不响应；面板侧自行决定「无更多炮击时保持不动」。
   */
  jumpShot?: (direction: -1 | 1) => void
  /**
   * 数字键骑乘：digit 1..7，isShift = 敌方（Shift+1–7）。缺省（2D 未接）= 数字键不响应。
   * **冲突消解**：自由飞行激活时数字键归飞行速率（useSceneFlyControls 现状）——
   * 宿主必须配 {@link isFlyMode}，true 时本函数不会被调用。
   */
  rideVehicle?: (digit: number, isShift: boolean) => void
  /** 自由飞行是否激活（3D = store.cam === 'free'；缺省视为否 → 数字键可归骑乘）。 */
  isFlyMode?: () => boolean
}

export function usePlaybackTransport(adapter: PlaybackTransportAdapter, { keyboard = true }: { keyboard?: boolean } = {}) {
  let resumeAfterScrub = false
  let scrubbing = false

  function togglePlay() {
    if (adapter.isPlaying()) {
      adapter.pause()
      return
    }
    // 停在终点时再按播放 = 从头重播（常见播放器语义）；否则 play 会在下一帧被夹回终点立即停止，看起来毫无反应
    if (adapter.isAtEnd?.()) adapter.restart?.()
    adapter.play()
  }

  function scrubStart() {
    if (scrubbing) return
    scrubbing = true
    resumeAfterScrub = adapter.isPlaying()
    if (resumeAfterScrub) adapter.pause()
  }

  function scrubEnd() {
    if (!scrubbing) return
    scrubbing = false
    if (resumeAfterScrub) adapter.play()
    resumeAfterScrub = false
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (adapter.isActive && !adapter.isActive()) return
    if (adapter.isReady && !adapter.isReady()) return
    if (isInteractiveTarget(event.target as EventTargetLike | null)) return
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault()
      togglePlay()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      adapter.step(event.key === 'ArrowLeft' ? -PLAYBACK_STEP_SECONDS : PLAYBACK_STEP_SECONDS)
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey
      && (event.code === 'Comma' || event.code === 'Period' || event.key === ',' || event.key === '.')) {
      // 跳炮击：',' 上一发 / '.' 下一发（code 主判据——布局稳定，Shift 变体同样生效；
      // Ctrl/Meta/Alt 组合键不劫持，留给浏览器/系统快捷键）。面板未接（2D）时不响应
      // 也不吞键——可输入控件已在上面挡掉，此处只剩播放器快捷键语义。
      if (!adapter.jumpShot) return
      event.preventDefault()
      adapter.jumpShot(event.code === 'Comma' || event.key === ',' ? -1 : 1)
    } else if (/^Digit[1-7]$/.test(event.code) && adapter.rideVehicle
      && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // 数字键骑乘（1–7 己方 / Shift+1–7 敌方）。冲突消解：自由飞行激活时数字键
      // 归飞行速率（useSceneFlyControls 的 1–6 速率键，现状不动）——这里整体让出，
      // 不 preventDefault 也不骑乘；Digit7 不在飞行档位表内，飞行模式下属无操作。
      // Ctrl/Meta/Alt 组合键不劫持（与逗号/句号分支同一纪律）：留给浏览器/系统快捷键。
      if (adapter.isFlyMode?.() === true) return
      event.preventDefault()
      adapter.rideVehicle(Number(event.code.slice(5)), event.shiftKey)
    }
  }

  if (keyboard && getCurrentInstance() && typeof window !== 'undefined') {
    onMounted(() => window.addEventListener('keydown', handleKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
  }

  return { togglePlay, scrubStart, scrubEnd, handleKeydown, isScrubbing: () => scrubbing }
}
