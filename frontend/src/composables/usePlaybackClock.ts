import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { advancePlaybackTime, clampPlaybackTime } from '../utils/playbackClock.js'
import { isPlaybackSpeed } from './usePlaybackTransport.js'

/**
 * 2D 回放播放时钟（#820 Agent C 拆分）：playback clock 的**唯一 owner**。
 *
 * 播放钟双轨：playbackClock = rAF 内部非响应式时钟（逐帧精确推进，事件消费 exactly-once
 * 的事实源）；currentTime = 响应式发布值，按 CLOCK_PUBLISH_SEC 节流写入——60fps 直写
 * ref 会让整条 computed 链（轨迹/炮线/标记/HP/布局）以 60fps 全量重算。两者由全部写入口
 * 保持同步（frame/play/seek/step/回绕），对外语义不变，仅派生视觉状态以 30Hz 刷新。
 *
 * 不复制第二个时钟：transient 状态与其消费规则 owner 仍是 usePlaybackTransients，
 * 本 composable 只在 frame/seek/step/回绕时调用其消费/重置入口；暂停期轻量 RAF
 * （仅当存在未决 transient）也由这里持有，不永久轮询。
 */
export function usePlaybackClock(deps: {
  /** 回放总时长（秒；无 dataset 时 0）。 */
  duration: () => number
  /** QA 场景循环播放（时间线到末尾自动回到 0 继续）。 */
  loop: () => boolean
  /** transient/animation 时间基准 = UI wall clock（performance.now），由宿主持有。 */
  nowMs: Ref<number>
  realNowMs: () => number
  /** transient 消费/重置入口（usePlaybackTransients 的宿主侧绑定）。 */
  consumeEvents: (fromSec: number, toSec: number) => void
  resetTransients: (sec: number) => void
  hasPendingTransients: (now: number) => boolean
  pruneTransients: (now: number) => void
  /** loop 回绕时只重置严格左开 cursor（不重置 transient，见 frame()）。 */
  rewindTransientCursor: () => void
  /** kill feed 当前是否可见（隐藏期间排队条目不驱动暂停时钟）。 */
  feedVisible: () => boolean
  /** 播放开始副作用（宿主：标注模式开着时先关闭）。 */
  onPlayStart: () => void
  /** 外部 seek 请求（AI 时间线点击），null = 无。 */
  seekTo: () => number | null
}) {
  const CLOCK_PUBLISH_SEC = 1 / 30
  let playbackClock = 0
  const currentTime = ref(0)
  const playing = ref(false)
  const speed = ref(1)

  /** 统一写入口：内部钟与响应式发布值同步置位（seek/step/回绕/到末尾）。
   * frame() 的逐帧推进不走这里（内部钟先行、发布值节流），见 frame()。 */
  function publishClock(t: number) {
    playbackClock = t
    currentTime.value = t
  }

  // seek/状态恢复帧：禁用 HP bar 过渡动画（§20.1 seek 只恢复状态不补动画）
  const hpNoTransition = ref(false)

  /** seek 后单帧禁用 HP bar transition（§20.1：只恢复状态，不补 150–300ms 缩短动画）。
   * 用 setTimeout 而非 requestAnimationFrame 清旗标：不占用共享 RAF 槽位（播放/
   * 暂停时钟仍由 rafCb 驱动，测试中 seek 后 rafCb 必须仍指向时钟回调）。 */
  function suppressHpTransition() {
    hpNoTransition.value = true
    if (typeof setTimeout === 'function') {
      setTimeout(() => { hpNoTransition.value = false }, 0)
    } else {
      hpNoTransition.value = false
    }
  }

  let rafId: number | null = null
  let lastFrameTs: number | null = null

  // 暂停期 transient 时钟的 RAF id（仅当存在未决 transient 时运行，不永久轮询）。
  let pauseRafId: number | null = null

  function frame(ts: number) {
    if (!playing.value) {
      rafId = null
      return
    }
    const delta = lastFrameTs == null ? 0 : (ts - lastFrameTs)
    lastFrameTs = ts
    const prev = playbackClock
    const next = advancePlaybackTime(prev, deps.duration(), delta, speed.value)
    playbackClock = next
    deps.nowMs.value = deps.realNowMs()
    // §1.3/§20.3/Blocker 2：先消费 (prev, next]（next 可 == duration——到达末尾前最后一段事件
    // 必须在停止/回绕前消费，exactly-once，不因到达 duration 丢失）；cursor 严格左开不重复。
    deps.consumeEvents(prev, next)
    if (next >= deps.duration()) {
      if (deps.loop()) {
        publishClock(0)
        // 循环回绕：只重置播放时间与严格左开 cursor。上一轮末尾刚消费的 transient 继续按
        // wall-clock 自然完成（「末尾消费一次」可见且不重复）；不重置 eventCursor 会把下一轮
        // (0, t] 的事件误判为已消费而静默跳过。
        deps.rewindTransientCursor()
        rafId = requestAnimationFrame(frame)
        return
      }
      publishClock(next)
      playing.value = false
      rafId = null
      // 播放到末尾自然停止 → 若有未决 transient，轻量 clock 接管
      ensurePauseClock(deps.realNowMs())
      return
    }
    // 响应式发布节流：距上次发布 ≥ 1/30s 才写 currentTime；currentTime 意外落后内部钟
    // （外部写入口未同步的兜底）时立即追平。
    if (next - currentTime.value >= CLOCK_PUBLISH_SEC || next < currentTime.value) {
      currentTime.value = next
    }
    rafId = requestAnimationFrame(frame)
  }

  /** 幂等启动：任意时刻最多一个 RAF 循环（重复调用/重复事件不会创建第二个循环）。 */
  function play() {
    if (playing.value || deps.duration() <= 0) return
    deps.onPlayStart()
    playing.value = true
    lastFrameTs = null
    playbackClock = currentTime.value
    // 播放开始：transient 时钟由 playback frame() 驱动——作废可能残留的轻量 pause RAF
    //（stub 环境只保留最近回调，若不清理，pause() 的 ensurePauseClock 会误判"已有 RAF"
    //  而无法注册接管时钟；真实浏览器中残留回调至多无害地刷新一次 nowMs）
    pauseRafId = null
    rafId = requestAnimationFrame(frame)
  }

  /** 幂等暂停：取消未完成的 RAF，绝不残留回调推进时间。 */
  function pause() {
    playing.value = false
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    // 发布值补齐到内部钟：节流发布下 currentTime 可能落后最后帧 ≤1/30s，暂停必须停在精确时刻
    if (currentTime.value !== playbackClock) currentTime.value = playbackClock
    // 播放中可能有未决 transient——暂停后立即让轻量 pause clock（UI wall clock）接管；
    // 无 pending 时不启动 RAF（不永久轮询）。
    ensurePauseClock(deps.realNowMs())
  }

  /** 幂等 seek：发布值直达 + transient 清空（§20.1 不补播）。 */
  function seek(sec: number) {
    publishClock(clampPlaybackTime(sec, deps.duration()))
    deps.nowMs.value = deps.realNowMs()
    deps.resetTransients(currentTime.value)
    suppressHpTransition()
  }

  function step(delta: number) {
    publishClock(clampPlaybackTime(currentTime.value + delta, deps.duration()))
    deps.resetTransients(currentTime.value)
    suppressHpTransition()
  }

  function setSpeed(next: number) {
    if (isPlaybackSpeed(next)) speed.value = next
  }

  // 外部 seek 请求（AI 时间线 → seek + 自动暂停，含取消 RAF）
  watch(() => deps.seekTo(), (sec) => {
    if (Number.isFinite(sec)) {
      pause()
      publishClock(clampPlaybackTime(sec!, deps.duration()))
      deps.resetTransients(currentTime.value)
      suppressHpTransition()
    }
  }, { immediate: true })

  /** 是否存在未决的 transient（暂停时需轻量时钟自然完成，§20.2）。 */
  function hasPendingPauseClock(now: number) {
    return deps.hasPendingTransients(now)
  }

  /** 轻量时钟：仅当存在未决 transient 且未在播放时维持 RAF；播放时由 frame() 驱动，
   *  无 pending 即停（不做永久轮询）。注意：只更新 nowMs，不在 watcher 内回写 nowMs
   *  （nowMs 是 watch source，回写会自触发无限循环）。 */
  function ensurePauseClock(now: number) {
    if (pauseRafId != null || playing.value) return
    if (hasPendingPauseClock(now)) {
      pauseRafId = requestAnimationFrame(() => {
        pauseRafId = null
        deps.nowMs.value = typeof performance !== 'undefined' ? performance.now() : Date.now()
        // nowMs 变化 → transient watch → pruneTransients + ensurePauseClock(新鲜 now) 决定续/停
      })
    }
  }

  // transient 过期清理（nowMs/currentTime 变化驱动；reactive Map 不无限增长）。
  // prune 后按新鲜 now 重估 pending：暂停期间仍有未决动画（如 kill feed 4s 展示）时
  // 续约轻量 RAF 让其自然完成（§20.2）；播放中调用会被 ensurePauseClock 的 playing
  // 守卫挡下，不会产生第二个循环。
  watch([() => deps.nowMs.value, currentTime], () => {
    deps.pruneTransients(deps.nowMs.value)
    ensurePauseClock(deps.nowMs.value)
  })

  // kill feed 恢复显示（showKillfeed / 沉浸态切换）：隐藏期间排队条目不驱动暂停时钟，
  // 恢复后重启轻量时钟让待展示条目自然完成（§20.2）。必须先把 nowMs 同步到新鲜墙钟
  // 再调度：visibleFeed 首次渲染提升排队条目时以 nowMs 记 shownAt——暂停超过 4s 后
  // nowMs 仍是旧值，不同步会把刚展示的条目下一帧判成早已过期（只闪现一帧）。
  watch(() => deps.feedVisible(), (visible) => {
    if (!visible) return
    const now = deps.realNowMs()
    deps.nowMs.value = now
    ensurePauseClock(now)
  })

  function disposeClock() {
    if (rafId != null) cancelAnimationFrame(rafId)
    if (pauseRafId != null) cancelAnimationFrame(pauseRafId)
    rafId = null
    pauseRafId = null
  }

  return {
    currentTime,
    playing,
    speed,
    hpNoTransition,
    publishClock,
    play,
    pause,
    seek,
    step,
    setSpeed,
    seekToEvent: (sec: number) => {
      // Event Panel 行点击：跳转并保持暂停。
      pause()
      seek(sec)
    },
    ensurePauseClock,
    disposeClock,
  }
}

export type PlaybackClock = ReturnType<typeof usePlaybackClock>
