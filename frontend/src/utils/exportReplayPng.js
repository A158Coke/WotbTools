/** Chrome/Firefox/Safari safe upper limit for canvas width/height. */
export const MAX_CANVAS_DIMENSION = 16384

/** Maximum scale applied to content. */
export const MAX_SCALE = 2

/**
 * Safety epsilon to absorb floating-point rounding when computing scale.
 * Guarantees width * scale <= MAX_CANVAS_DIMENSION after multiplication.
 */
const EPSILON = 1e-9

/**
 * Return the DOM element to capture for the current active tab.
 * @param {string} activeTab - 'aggregate' or 'b{index}'
 * @param {HTMLElement|null} aggregateRef - aggregate container ref
 * @param {HTMLElement[]} battleRefs - battle container refs array
 * @returns {HTMLElement|null}
 */
export function getExportTarget(activeTab, aggregateRef, battleRefs) {
  if (activeTab === 'aggregate') return aggregateRef
  const idx = parseInt(activeTab.replace('b', ''), 10)
  if (!isNaN(idx) && battleRefs && battleRefs[idx]) return battleRefs[idx]
  return null
}

/**
 * Compute safe canvas dimensions and scale for the given element.
 * Guarantees width * scale <= MAX_CANVAS_DIMENSION and height * scale <= MAX_CANVAS_DIMENSION.
 * Scale is computed as the minimum of MAX_SCALE, MAX_DIM / width, MAX_DIM / height,
 * reduced by an epsilon to absorb floating-point rounding.
 * @param {HTMLElement} el
 * @returns {{ width: number, height: number, scale: number }}
 */
export function computeExportDimensions(el) {
  const rawW = el.scrollWidth
  const rawH = el.scrollHeight

  // Reject non-finite, zero, or negative dimensions
  const contentW = Number.isFinite(rawW) && rawW > 0 ? rawW : 0
  const contentH = Number.isFinite(rawH) && rawH > 0 ? rawH : 0

  if (contentW <= 0 || contentH <= 0) {
    return { width: 800, height: 600, scale: 1 }
  }

  const maxDim = MAX_CANVAS_DIMENSION
  const sx = maxDim / contentW
  const sy = maxDim / contentH
  const scale = Math.min(MAX_SCALE, sx, sy) - EPSILON

  return {
    width: contentW,
    height: contentH,
    scale: Math.max(scale, 0)
  }
}

/**
 * Generate a stable, safe PNG filename.
 * @param {string} activeTab - 'aggregate' or 'b{index}'
 * @param {number} battleIndex - 0-based battle index (for single battle)
 * @param {string} [mapName] - sanitized map name (optional)
 * @returns {string}
 */
export function exportPngFilename(activeTab, battleIndex, mapName) {
  const ts = new Date()
  const date = [
    ts.getFullYear(),
    String(ts.getMonth() + 1).padStart(2, '0'),
    String(ts.getDate()).padStart(2, '0')
  ].join('')
  const time = [
    String(ts.getHours()).padStart(2, '0'),
    String(ts.getMinutes()).padStart(2, '0'),
    String(ts.getSeconds()).padStart(2, '0')
  ].join('')

  const base = `wotb-replay-${date}-${time}`
  if (activeTab === 'aggregate') return `${base}-aggregate.png`

  const safeMap = mapName ? sanitizeFilename(mapName) : `battle-${battleIndex + 1}`
  return `${base}-${safeMap}.png`
}

/**
 * Remove characters unsafe for filenames across Windows/macOS/Linux.
 * Keeps alphanumeric, hyphen, underscore, and dot.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'export'
}

/**
 * Download a Blob as a file using an <a> element.
 * Cleans up the object URL and DOM node after a brief delay.
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<void>}
 */
export function downloadBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    if (!blob) return reject(new Error('Blob is null'))

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()

    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      resolve()
    }, 150)
  })
}
