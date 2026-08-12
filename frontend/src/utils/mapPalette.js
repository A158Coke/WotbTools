/**
 * 地图鸟瞰自适应配色（2026-08-12 落档规则）：
 * 按地图底图平均相对亮度（sRGB 加权，降采样 64×64）自动选择「暗图/亮图」两套调色板，
 * 避免热力/路线/网格与地图底图颜色混淆。canvas 不可用或计算失败时回退暗图默认色板。
 * 规则与阈值同步见 docs/DEVELOPER_GUIDE.md「地图鸟瞰（Map Overview）」节。
 */

/** 亮度阈值：平均相对亮度 < 0.45 视为暗图，否则为亮图。 */
export const LUMINANCE_THRESHOLD = 0.45

/** 暗图默认色板（现状配色：亮色系 + 白系网格）。 */
export const darkMapPalette = {
  friendlyColors: ['#ff7a1a', '#ffb01a', '#e85d2a', '#ff8f4d', '#d96b0f', '#ffc266', '#b74e1e'],
  enemyColors: ['#2f7dff', '#4aa3ff', '#1f5fd6', '#7ab8ff', '#144ba8', '#9ecbff', '#0e3a7d'],
  heatFriendly: '#ff7a1a',
  heatEnemy: '#2f7dff',
  gridStroke: 'rgba(255,255,255,.16)',
  regionStroke: 'rgba(255,255,255,.55)',
  regionLabel: 'rgba(255,255,255,.8)',
  spawnFriendly: '#ffd166',
  spawnEnemy: '#4aa3ff',
  routeOutline: 'rgba(0,0,0,.45)',
  deathMark: '#ff3b30'
}

/** 亮图色板：深饱和色系 + 深色网格，保证浅色底图上的可区分度。 */
export const lightMapPalette = {
  friendlyColors: ['#c2410c', '#b45309', '#9a3412', '#d97706', '#7c2d12', '#ea580c', '#92400e'],
  enemyColors: ['#1d4ed8', '#1e40af', '#2563eb', '#3730a3', '#1e3a8a', '#3b82f6', '#172554'],
  heatFriendly: '#c2410c',
  heatEnemy: '#1d4ed8',
  gridStroke: 'rgba(0,0,0,.22)',
  regionStroke: 'rgba(0,0,0,.55)',
  regionLabel: 'rgba(0,0,0,.82)',
  spawnFriendly: '#b45309',
  spawnEnemy: '#1e40af',
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
