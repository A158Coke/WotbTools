/**
 * 实时帧率统计（**只统计真正渲染的帧**）。
 *
 * 为什么不是数 rAF 回调：按需渲染下，rAF 每帧都会跑，但只有脏帧才真正 render
 *（暂停静止时一帧都不画）。用 rAF 回调数会得到"120 FPS"这种与实际观感无关的数——
 * 用户实测「卡顿和显示的帧率不符」正是这个。这里喂的是**每次 render 的时刻**，
 * 于是 fps/峰值帧时与画面更新节奏一致；空闲 >600ms 时由调用方发布 0（角标显示 —）。
 *
 * 窗口内输出 fps（帧/窗口）、frameMs（平均帧间隔）与 peakMs（窗口内最差一帧间隔，
 * 用于暴露"平均还行但有顿挫"）。窗口内相邻两次渲染间隔 > maxGapMs（默认 250ms）
 * 视为空闲断层：重新起窗，不计入峰值/平均（否则暂停后的第一帧会毒化整窗）。
 */
export function createFrameMeter({ windowMs = 500, maxGapMs = 250 } = {}) {
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
      if (gap > maxGapMs) { startedAt = now; frames = 0; peakMs = 0; return null }  // 空闲断层：新窗口
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
    /** 停帧 / 重建 / 长时间空闲后归零（下一次 sample 重新起窗） */
    reset() { active = false; startedAt = 0; lastAt = 0; frames = 0; fps = 0; frameMs = 0; peakMs = 0 },
  }
}
