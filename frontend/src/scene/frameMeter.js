/**
 * 实时帧率统计（**只统计真正渲染的帧**）。
 *
 * 为什么不是数 rAF 回调：按需渲染下，rAF 每帧都会跑，但只有脏帧才真正 render
 *（暂停静止时一帧都不画）。用 rAF 回调数会得到"120 FPS"这种与实际观感无关的数——
 * 用户实测「卡顿和显示的帧率不符」正是这个。这里喂的是**每次 render 的时刻**。
 *
 * **空闲判定归调用方**：持续渲染中的长帧（例如 300ms/帧）是真实性能数据，必须计入
 * 统计；只有场景明确进入空闲/暂停时才调 `reset()` 重新起窗（评审 P2：曾按
 * `gap > 250ms` 自动重起，把真实卡顿也抹掉——连续 300ms 帧永远发不出统计）。
 *
 * 窗口内输出 fps（帧/窗口）、frameMs（平均帧间隔）与 peakMs（窗口内最差一帧间隔，
 * 用于暴露"平均还行但有顿挫"）。
 */
export function createFrameMeter({ windowMs = 500 } = {}) {
  let active = false   // 用独立标志起窗：performance.now() 合法值为 0，不能拿 0 当哨兵
  let startedAt = 0
  let lastAt = 0
  let frames = 0
  let fps = 0
  let frameMs = 0
  let peakMs = 0

  const round1 = (n) => Math.round(n * 10) / 10

  return {
    /** @returns {{fps:number, frameMs:number, peakMs:number}|null} 窗口结束时返回统计，否则 null */
    sample(now) {
      if (!active) { active = true; startedAt = now; lastAt = now; frames = 0; peakMs = 0; return null }
      const gap = now - lastAt
      lastAt = now
      frames++
      if (gap > peakMs) peakMs = gap
      const elapsed = now - startedAt
      if (elapsed < windowMs) return null
      fps = round1((frames * 1000) / elapsed)
      frameMs = round1(elapsed / frames)
      const out = { fps, frameMs, peakMs: round1(peakMs) }
      startedAt = now
      frames = 0
      peakMs = 0
      return out
    },
    get fps() { return fps },
    get frameMs() { return frameMs },
    get peakMs() { return peakMs },
    /** 空闲 / 暂停 / 重建时由调用方显式调用（下一次 sample 重新起窗） */
    reset() { active = false; startedAt = 0; lastAt = 0; frames = 0; fps = 0; frameMs = 0; peakMs = 0 },
  }
}
