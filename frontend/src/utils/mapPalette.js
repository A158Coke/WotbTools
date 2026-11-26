
export const LUMINANCE_THRESHOLD = 0.45

export const darkMapPalette = {
  heatFriendly: '#22c55e',
  heatEnemy: '#ef4444',
  gridStroke: 'rgba(255,255,255,.16)',
  gridStrokeStrong: 'rgba(255,255,255,.55)',
  regionStroke: 'rgba(255,255,255,.55)',
  spawnFriendly: '#4ade80',
  spawnEnemy: '#ef4444',
  routeOutline: 'rgba(0,0,0,.45)',
  deathMark: '#ff3b30'
}

export const lightMapPalette = {
  heatFriendly: '#15803d',
  heatEnemy: '#b91c1c',
  gridStroke: 'rgba(0,0,0,.22)',
  gridStrokeStrong: 'rgba(0,0,0,.55)',
  regionStroke: 'rgba(0,0,0,.55)',
  spawnFriendly: '#15803d',
  spawnEnemy: '#b91c1c',
  routeOutline: 'rgba(255,255,255,.6)',
  deathMark: '#dc2626'
}

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
