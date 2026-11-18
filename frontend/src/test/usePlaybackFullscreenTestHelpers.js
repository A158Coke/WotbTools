import { vi } from 'vitest'
import { effectScope } from 'vue'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.ts'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.ts'
export function stubMatchMedia(matchesByQuery = {}) {
  const mql = (query) => ({
    matches: !!matchesByQuery[query],
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
  vi.stubGlobal('matchMedia', mql)
}

/** happy-dom 没有 Fullscreen / Orientation API：按用例装/卸 */
export function stubBrowserApis({ fullscreen = true, lock = 'resolve', unlock = true } = {}) {
  const calls = { request: 0, exit: 0, lock: [], unlock: 0 }
  const root = document.createElement('div')
  document.body.appendChild(root)
  if (fullscreen) {
    root.requestFullscreen = vi.fn(() => {
      calls.request++
      Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
  }
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: vi.fn(() => {
      calls.exit++
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    }),
  })
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
  const orientation = {}
  if (lock !== 'absent') {
    orientation.lock = vi.fn((o) => {
      calls.lock.push(o)
      return lock === 'reject' ? Promise.reject(new Error('not allowed')) : Promise.resolve()
    })
  }
  if (unlock) orientation.unlock = vi.fn(() => { calls.unlock++ })
  // `screen` 始终存在：`lock: 'absent'` 模拟的是「有 screen、但没有 orientation.lock」
  //（Safari / 部分 WebView 的真实形状），而不是 screen 本身缺失。
  vi.stubGlobal('screen', { orientation })
  return { root, calls }
}

export function mountFullscreen({ target, isActive = () => true } = {}) {
  const root = document.body.lastElementChild
  const scope = effectScope()
  let api
  scope.run(() => {
    const phone = usePlaybackPhoneForm()
    api = usePlaybackFullscreen({
      target: target ?? (() => root),
      isPhone: phone.isPhone,
      isActive,
    })
  })
  return { api, stop: () => scope.stop() }
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
