// 射击结果卡（armor viewer #traj-info）的尺寸口径。
// 竖屏手机屏幕窄且卡片是 fixed overlay，桌面尺寸会占掉过多纵向空间；
// 这里只负责“紧凑档”数值，渲染仍由 tankViewer 的 showTrajectory 消费。
export function isCompactShotResultCard(viewportWidth, viewportHeight) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return false
  // 窄屏竖屏手机（原口径）+ **横屏手机 / 矮视口**：结果卡是 fixed overlay，720p 桌面档
  // 在 390–430px 高的横屏里会盖掉大半视口（用户 2026-10-28 反馈；2026-10-30 再缩小一档）。
  return (viewportWidth < 768 && viewportHeight > viewportWidth) || viewportHeight < 520
}

export function shotResultCardMetrics(compact) {
  if (compact) {
    return {
      padding: '4px 8px',
      radius: 7,
      borderWidth: 3,
      topFont: 10,
      titleFont: 13,
      damageFont: 12,
      chanceFont: 11,
      expectedFont: 10,
      expectedLine: 13,
      layerFont: 11,
      layerLine: 15,
      bulletWidth: 10,
      indexWidth: 14,
      inlineGap: 6,
      damageGap: 5,
      marginTight: 1,
      marginNormal: 3,
    }
  }
  return {
    padding: '10px 16px',
    radius: 10,
    borderWidth: 4,
    topFont: 12,
    titleFont: 18,
    damageFont: 16,
    chanceFont: 14,
    expectedFont: 12,
    expectedLine: 18,
    layerFont: 13,
    layerLine: 20,
    bulletWidth: 14,
    indexWidth: 20,
    inlineGap: 14,
    damageGap: 8,
    marginTight: 4,
    marginNormal: 6,
  }
}

/**
 * 结果卡最大宽度：随画布宽度走（侧栏/窄画布不能按视口算）；紧凑档（竖屏手机 / 横屏矮视口）
 * 再封顶 360px，避免横屏里铺满整屏（2026-10-30 用户反馈移动端卡片过大）。hostWidth 无效时返回 null（不设上限）。
 */
export function shotResultCardMaxWidth(hostWidth, viewportWidth, viewportHeight) {
  const width = Number(hostWidth)
  if (!(width > 0)) return null
  const compact = isCompactShotResultCard(viewportWidth, viewportHeight)
  const fitted = Math.max(compact ? 180 : 220, Math.floor(width - (compact ? 16 : 32)))
  return compact ? Math.min(fitted, 360) : fitted
}
