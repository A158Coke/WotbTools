/**
 * Replay result PNG export utilities.
 * Pure functions for DOM target selection, dimension calculation,
 * safe scaling, filename generation, and blob download.
 */

/** Chrome/Firefox/Safari safe upper limit for canvas width/height. */
export const MAX_CANVAS_DIMENSION = 16384

/** Maximum scale applied to content. */
export const MAX_SCALE = 2

/** Minimum scale for readable output. */
export const MIN_SCALE = 0.5

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
 * Always uses full scroll dimensions (not just visible area).
 * @param {HTMLElement} el
 * @returns {{ width: number, height: number, scale: number }}
 */
export function computeExportDimensions(el) {
  const contentW = el.scrollWidth || el.clientWidth || 0
  const contentH = el.scrollHeight || el.clientHeight || 0

  // Fallback for zero dimensions
  if (contentW <= 0 || contentH <= 0) {
    return { width: 800, height: 600, scale: 1 }
  }

  // Calculate scale that keeps both dimensions within the max canvas limit.
  // Use floor to guarantee the result never exceeds the limit after rounding.
  let scale = MAX_SCALE
  if (contentW * scale > MAX_CANVAS_DIMENSION) {
    scale = Math.floor((MAX_CANVAS_DIMENSION / contentW) * 100) / 100
  }
  if (contentH * scale > MAX_CANVAS_DIMENSION) {
    scale = Math.min(scale, Math.floor((MAX_CANVAS_DIMENSION / contentH) * 100) / 100)
  }
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))

  return {
    width: contentW,
    height: contentH,
    scale: Math.round(scale * 100) / 100 // round to 2 decimals
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

    // Cleanup after allowing the browser to start the download
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      resolve()
    }, 150)
  })
}
