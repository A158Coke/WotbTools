import { getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'

/**
 * 2D / 3D 回放共用的播放传输行为（与 PlaybackTransport.vue 配套）。
 *
 * 不持有播放状态：时间与播放中标志的唯一 owner 仍是各自的播放器（2D 的 BattlePlayback、
 * 3D 的 playbackScene），这里只通过 adapter 读写，统一三件事：
 * - 速度档位 / 默认速度 / 跳秒步长；
 * - 拖动进度条：按下即暂停，松手时若原先在播放则自动继续；
 * - 键盘：空格 播放/暂停、←/→ ±5s；输入框 / 按钮聚焦时与播放器不可见时不响应。
 */
export const PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4, 8])
export const DEFAULT_PLAYBACK_SPEED = 1
export const PLAYBACK_STEP_SECONDS = 5

export function isPlaybackSpeed(value) {
  return PLAYBACK_SPEEDS.includes(value)
}

/** 键盘事件落在可输入 / 可操作控件上时不劫持（空格要留给按钮和输入框本身） */
export function isInteractiveTarget(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}

/**
 * @param {object} adapter
 * @param {() => boolean} adapter.isPlaying
 * @param {() => void} adapter.play
 * @param {() => void} adapter.pause
 * @param {(deltaSeconds: number) => void} adapter.step
 * @param {() => boolean} [adapter.isActive]  播放器当前是否可见 / 可交互（缺省视为可交互）
 * @param {() => boolean} [adapter.isReady]   时间轴是否已就绪（缺省视为就绪）
 * @param {object} [options]
 * @param {boolean} [options.keyboard=true]   是否在组件生命周期内挂全局键盘监听
 */
export function usePlaybackTransport(adapter, { keyboard = true } = {}) {
  let resumeAfterScrub = false
  let scrubbing = false

  function togglePlay() {
    if (adapter.isPlaying()) adapter.pause()
    else adapter.play()
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

  function handleKeydown(event) {
    if (adapter.isActive && !adapter.isActive()) return
    if (adapter.isReady && !adapter.isReady()) return
    if (isInteractiveTarget(event.target)) return
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault()
      togglePlay()
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      adapter.step(event.key === 'ArrowLeft' ? -PLAYBACK_STEP_SECONDS : PLAYBACK_STEP_SECONDS)
    }
  }

  if (keyboard && getCurrentInstance() && typeof window !== 'undefined') {
    onMounted(() => window.addEventListener('keydown', handleKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
  }

  return { togglePlay, scrubStart, scrubEnd, handleKeydown, isScrubbing: () => scrubbing }
}
