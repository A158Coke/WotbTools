import { QUALITY_PRESETS } from './quality.js'

export function boolPref(key: string, urlKey: string, dflt: boolean): boolean {
  try {
    const usp = new URLSearchParams(location.search)
    if (usp.has(urlKey)) return usp.get(urlKey) !== '0'
    const v = localStorage.getItem(key)
    return v == null ? dflt : v === '1'
  } catch (e) { return dflt }
}

export function persistBoolPref(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? '1' : '0') } catch (_) {}
}

export function consumeUrlBool(urlKey: string): boolean | null {
  try {
    const url = new URL(location.href)
    if (!url.searchParams.has(urlKey)) return null
    const value = url.searchParams.get(urlKey) !== '0'
    url.searchParams.delete(urlKey)
    history.replaceState(history.state, '', url)
    return value
  } catch { return null }
}
export function resolveQualityKey(): string {
  const usp = new URLSearchParams(location.search)
  let q = (usp.get('q') || '').toLowerCase()
  const known = (key: string): boolean => Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, key)
  if (!known(q)) { try { q = localStorage.getItem('pb_quality') || '' } catch (e) {} }
  if (!known(q)) {
    const tauri = window.__TAURI__
    const mobile = !!tauri || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
    q = mobile ? 'mid' : 'high'
  }
  try { localStorage.setItem('pb_quality', q) } catch (e) {}
  return q
}
