/**
 * 地图鸟瞰自适应配色（2026-08-12 落档规则）：
 * 按地图底图平均相对亮度（sRGB 加权，降采样 64×64）自动选择「暗图/亮图」两套调色板，
 * 避免热力/路线/网格与地图底图颜色混淆。canvas 不可用或计算失败时回退暗图默认色板。
 * 规则与阈值同步见 docs/features/battle-playback.md。
 */

/** 亮度阈值：平均相对亮度 < 0.45 视为暗图，否则为亮图。 */
export const LUMINANCE_THRESHOLD = 0.45

/** 暗图默认色板（现状配色：亮色系 + 白系网格）。 */
export const darkMapPalette = {
  friendlyColors: ['#22c55e', '#4ade80', '#16a34a', '#86efac', '#15803d', '#6ee7b7', '#10b981'],
  enemyColors: ['#ef4444', '#f87171', '#dc2626', '#fca5a5', '#b91c1c', '#fb7185', '#f43f5e'],
  heatFriendly: '#22c55e',
  heatEnemy: '#ef4444',
  gridStroke: 'rgba(255,255,255,.16)',
  regionStroke: 'rgba(255,255,255,.55)',
  spawnFriendly: '#4ade80',
  spawnEnemy: '#ef4444',
  routeOutline: 'rgba(0,0,0,.45)',
  deathMark: '#ff3b30'
}

/** 亮图色板：深饱和色系 + 深色网格，保证浅色底图上的可区分度。 */
export const lightMapPalette = {
  friendlyColors: ['#166534', '#15803d', '#14532d', '#16a34a', '#22c55e', '#15803d', '#052e16'],
  enemyColors: ['#b91c1c', '#991b1b', '#dc2626', '#7f1d1d', '#ef4444', '#c81e1e', '#450a0a'],
  heatFriendly: '#15803d',
  heatEnemy: '#b91c1c',
  gridStroke: 'rgba(0,0,0,.22)',
  regionStroke: 'rgba(0,0,0,.55)',
  spawnFriendly: '#15803d',
  spawnEnemy: '#b91c1c',
  routeOutline: 'rgba(255,255,255,.6)',
  deathMark: '#dc2626'
}

/** 按平均相对亮度选择色板；null/非有限值（计算失败）回退暗图默认色板。 */
export function paletteForLuminance(luminance) {
  if (luminance == null || !Number.isFinite(luminance)) return darkMapPalette
  return luminance < LUMINANCE_THRESHOLD ? darkMapPalette : lightMapPalette
}

/**
 * 计算地图图片的平均相对亮度（sRGB 线性化后按 0.2126/0.7152/0.0722 加权）。
 * 图片降采样到 64×64 再读像素，避免大图 getImageData 开销。
 * @param {{src: string, width?: number, height?: number}} image mapImages 中的图片元信息
 * @returns {Promise<number|null>} 0..1 的平均相对亮度；canvas 不可用/图片加载失败时为 null
 */
export async function luminanceOfImage(image) {
  if (!image || !image.src) return null
  try {
    const img = new Image()
    img.src = image.src
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
    })
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data
    const linearize = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * linearize(data[i] / 255)
        + 0.7152 * linearize(data[i + 1] / 255)
        + 0.0722 * linearize(data[i + 2] / 255)
    }
    return sum / (size * size)
  } catch {
    return null
  }
}
