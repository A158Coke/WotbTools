const portraitModules = import.meta.glob('../assets/tank-portraits/tier-x/*.webp', {
  query: '?url',
  import: 'default',
})

const cache = new Map()

function modulePath(tankId) {
  const id = Number(tankId)
  return Number.isInteger(id) && id > 0
    ? `../assets/tank-portraits/tier-x/${id}.webp`
    : null
}

export function hasVehiclePortrait(tankId) {
  const path = modulePath(tankId)
  return path != null && typeof portraitModules[path] === 'function'
}

/**
 * 按 tankId 懒加载车型图 URL。缺图或单图加载失败返回 null，Details Panel 静默降级。
 * @returns {Promise<string|null>}
 */
export function loadVehiclePortrait(tankId) {
  const path = modulePath(tankId)
  const loader = path == null ? null : portraitModules[path]
  if (typeof loader !== 'function') return Promise.resolve(null)
  if (!cache.has(path)) {
    cache.set(path, loader().then((url) => typeof url === 'string' ? url : null).catch(() => null))
  }
  return cache.get(path)
}
