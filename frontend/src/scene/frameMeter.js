/**
 * 实时帧率统计（rAF 间隔的固定窗口均值）。
 *
 * 语义：窗口内 `frames / elapsed` → FPS；frameMs = elapsed / frames（含本帧渲染耗时）。
 * 窗口未满时 `sample()` 返回 null（首次 500ms 内没有可展示值）。窗口按时间重置，
 * 不做指数平滑——诊断要的是"这一秒到底多少帧"，而不是被历史值拖慢的滤波值。
 *
 * 纯函数状态机，供场景内核每帧喂 `performance.now()`；单测直接喂时间戳。
 */
export function createFrameMeter({ windowMs = 500 } = {}) {
  let active = false;   // 用独立标志起窗：performance.now() 合法值为 0，不能拿 0 当哨兵
  let startedAt = 0;
  let frames = 0;
  let fps = 0;
  let frameMs = 0;

  return {
    /** @returns {{fps:number, frameMs:number}|null} 窗口结束时返回本窗口统计，否则 null */
    sample(now) {
      if (!active) { active = true; startedAt = now; frames = 0; return null }
      frames++;
      const elapsed = now - startedAt;
      if (elapsed < windowMs) return null;
      fps = Math.round((frames * 1000 / elapsed) * 10) / 10;
      frameMs = Math.round((elapsed / frames) * 10) / 10;
      startedAt = now;
      frames = 0;
      return { fps, frameMs }
    },
    get fps() { return fps },
    get frameMs() { return frameMs },
    /** 停帧 / 重建后归零（下一次 sample 重新起窗） */
    reset() { active = false; startedAt = 0; frames = 0; fps = 0; frameMs = 0 },
  }
}
