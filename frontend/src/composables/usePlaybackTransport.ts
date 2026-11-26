import { getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'

export const PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4, 8])
export const DEFAULT_PLAYBACK_SPEED = 1
export const PLAYBACK_STEP_SECONDS = 5

export function isPlaybackSpeed(value: unknown): boolean {
  return PLAYBACK_SPEEDS.includes(value as number)
}

export interface EventTargetLike {
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
export interface PlaybackTransportAdapter {
  isPlaying: () => boolean
  play: () => void
  pause: () => void
  step: (deltaSeconds: number) => void
  isActive?: () => boolean
  isReady?: () => boolean
  isAtEnd?: () => boolean
  restart?: () => void
  jumpShot?: (direction: -1 | 1) => void
  rideVehicle?: (digit: number, isShift: boolean) => void
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
      if (!adapter.jumpShot) return
      event.preventDefault()
      adapter.jumpShot(event.code === 'Comma' || event.key === ',' ? -1 : 1)
    } else if (/^Digit[1-7]$/.test(event.code) && adapter.rideVehicle
      && !event.ctrlKey && !event.metaKey && !event.altKey) {
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
