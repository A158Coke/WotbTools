// 射击结果卡（armor viewer #traj-info）的尺寸口径。
// 竖屏手机屏幕窄且卡片是 fixed overlay，桌面尺寸会占掉过多纵向空间；
// 这里只负责“紧凑档”数值，渲染仍由 tankViewer 的 showTrajectory 消费。
export function isCompactShotResultCard(viewportWidth, viewportHeight) {
  return Number.isFinite(viewportWidth) && Number.isFinite(viewportHeight)
    && viewportWidth < 768
    && viewportHeight > viewportWidth
}

export function shotResultCardMetrics(compact) {
  if (compact) {
    return {
      padding: '6px 10px',
      radius: 8,
      borderWidth: 3,
      topFont: 11,
      titleFont: 15,
      damageFont: 13,
      chanceFont: 12,
      expectedFont: 11,
      expectedLine: 15,
      layerFont: 11,
      layerLine: 16,
      bulletWidth: 12,
      indexWidth: 16,
      inlineGap: 8,
      damageGap: 6,
      marginTight: 2,
      marginNormal: 4,
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
