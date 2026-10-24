// playbackScene 内核的纯函数（无场景状态；2026-10-24 自 playbackScene.js 出仓，
// 拆分计划见 docs/current-plan.md；代码与搬移前逐字一致——公开 API 仍由
// playbackScene.js re-export，导入方零改动）。

/**
 * 飞行段时长（秒）= **真实飞行时长**（`shots[].flight_secs` = |终点−炮口|/弹速）。
 * 只做 1 帧下限：防退化数据（0/负数/非有限）造成零时长与除零；**不做"最小显示时长"**
 * —— 曾用 0.22s 下限"保证可见性"，实测 68% 的射击真飞行时长 <0.22s（J39 样本 155 发：
 * 中位 0.16s、p10 0.04s，弹速 560~1658 m/s），那些炮弹被拖慢最多 11×，与客户端不一致。
 */
export function tracerSpanSecs(flightSecs) {
  const oneFrame = 1 / 60
  return Number.isFinite(flightSecs) && flightSecs > oneFrame ? flightSecs : oneFrame
}

/** 线段经过的格子键（2D DDA；纯函数，单测锁定；用于标签遮挡的候选格选取） */
export function occlusionCells(ax, ay, bx, by, cell = 16) {
  const out = new Set();
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (cell / 2)));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    out.add(`${Math.floor((ax + dx * k) / cell)},${Math.floor((ay + dy * k) / cell)}`);
  }
  return out;
}

/** 遮挡物足印覆盖的**全部**格子（AABB 全枚举；纯函数，单测锁定；occGrid 登记专用）。
 *  与 occlusionCells（线段 DDA 遍历，检测时选候选格）是两个概念，不可互用：登记若走
 *  线段遍历（从包围盒角到角），只有对角线经过的格子入表，大建筑/大网格的非对角线
 *  覆盖格子全部缺失——穿那些格子的相机→标签射线在候选表里查不到该遮挡物，标签
 *  隔楼可见（false-visible）。每轴格数钳制 64（16m 格 × 64 ≈ 1km，远超静态建筑
 *  尺度；防病态大包围球把登记表撑爆）。 */
export function occlusionFootprintCells(minX, minY, maxX, maxY, cell = 16) {
  let gx0 = Math.floor(minX / cell), gx1 = Math.floor(maxX / cell);
  let gy0 = Math.floor(minY / cell), gy1 = Math.floor(maxY / cell);
  const MAX_SPAN = 64;
  if (gx1 - gx0 >= MAX_SPAN) { const c = Math.floor((gx0 + gx1) / 2); gx0 = c - (MAX_SPAN >> 1); gx1 = gx0 + MAX_SPAN - 1; }
  if (gy1 - gy0 >= MAX_SPAN) { const c = Math.floor((gy0 + gy1) / 2); gy0 = c - (MAX_SPAN >> 1); gy1 = gy0 + MAX_SPAN - 1; }
  const out = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) out.push(`${gx},${gy}`);
  }
  return out;
}
