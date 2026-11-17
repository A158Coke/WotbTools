// 渲染偏好 / 画质档解析（#820 行数预算拆分，2026-11-17）：从 playbackScene.js
// 抽出与场景闭包无关的 URL/localStorage 读取，保持每次 initPlayback 调用时求值
// （测试在 beforeEach 改 URL 后建场景，不能在模块加载期缓存）。
import { QUALITY_PRESETS } from './quality.js'

/** URL ?key=0/1 优先，其次 localStorage '1'/'0'，否则默认值。 */
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

/**
 * 画质档解析：URL ?q= > localStorage > 设备默认；四档都开 3D 地形（仅分段数降档）。
 * 移动/Tauri 默认**均衡**（真车模、完整场景和烘焙地表）；4K/Retina 想吃满填充率的
 * 显式选极致，桌面默认不背 DPR 2 的税。
 */
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
