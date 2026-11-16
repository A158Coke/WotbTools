// 射击结果卡（armor viewer #traj-info）的尺寸口径。
// 竖屏手机屏幕窄且卡片是 fixed overlay，桌面尺寸会占掉过多纵向空间；
// 这里只负责“紧凑档”数值，渲染仍由 scene/viewer/trajectoryCard.ts 的 showTrajectory 消费。
export function isCompactShotResultCard(viewportWidth, viewportHeight) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return false
  // 窄屏竖屏手机（原口径）+ **横屏手机 / 矮视口**：结果卡是 fixed overlay，720p 桌面档
  // 在 390–430px 高的横屏里会盖掉大半视口（用户 2026-10-28 反馈；2026-10-30 再缩小一档）。
  return (viewportWidth < 768 && viewportHeight > viewportWidth) || viewportHeight < 520
}

/**
 * 紧凑档的**比例缩放**（2026-11-15 用户裁示：结果卡改为跟随命中位置后，手机端不能占太大面积）。
 * 以视口短边为基准线性缩放，320–520px 之间从 0.88 收敛到 1；桌面档恒为 1。
 * 只缩字号/行高/间距，不缩圆角与左边框（视觉身份保持不变）。
 */
export function shotResultCardScale(viewportWidth, viewportHeight) {
  if (!isCompactShotResultCard(viewportWidth, viewportHeight)) return 1
  const shortSide = Math.min(viewportWidth, viewportHeight)
  return Math.max(0.88, Math.min(1, shortSide / 520))
}

const SCALED_FIELDS = [
  'topFont', 'titleFont', 'damageFont', 'chanceFont', 'expectedFont', 'expectedLine',
  'layerFont', 'layerLine', 'bulletWidth', 'indexWidth', 'inlineGap', 'damageGap',
  'marginTight', 'marginNormal',
]

const round1 = (value) => Math.round(value * 10) / 10

/** 数值字段按 scale 缩小；padding 的 px 值同样按比例收（渲染端只读这些字段）。 */
function scaleMetrics(metrics, scale) {
  if (scale === 1) return metrics
  const scaled = { ...metrics }
  for (const field of SCALED_FIELDS) scaled[field] = round1(metrics[field] * scale)
  scaled.padding = metrics.padding
    .split(' ')
    .map((part) => (/^-?\d+(?:\.\d+)?px$/.test(part) ? `${round1(parseFloat(part) * scale)}px` : part))
    .join(' ')
  return scaled
}

export function shotResultCardMetrics(compact, scale = 1) {
  const metrics = compact
    ? {
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
    : {
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
  return scaleMetrics(metrics, Number.isFinite(scale) && scale > 0 ? scale : 1)
}

/**
 * 结果卡最大宽度：随画布宽度走（侧栏/窄画布不能按视口算）；紧凑档（竖屏手机 / 横屏矮视口）
 * 再封顶 360px，并限制在画布宽度的 82% 以内（2026-11-15 用户裁示：跟随点击后手机端卡片
 * 不得铺满视口）。hostWidth 无效时返回 null（不设上限）。
 */
export function shotResultCardMaxWidth(hostWidth, viewportWidth, viewportHeight) {
  const width = Number(hostWidth)
  if (!(width > 0)) return null
  const compact = isCompactShotResultCard(viewportWidth, viewportHeight)
  const fitted = Math.max(compact ? 180 : 220, Math.floor(width - (compact ? 16 : 32)))
  if (!compact) return fitted
  return Math.min(fitted, 360, Math.round(width * 0.82))
}
