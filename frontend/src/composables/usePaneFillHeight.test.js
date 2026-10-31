// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { bottomChromeHeight } from './usePaneFillHeight.js'

/**
 * 底部固定导航预算（Codex #4432009935 / A158Coke 复核）：手机竖屏 `AppTabBar` 是
 * `position: fixed; bottom: 0`（56px + safe-area），盖在内容之上而 `#app` 的
 * padding-bottom 不缩短显式算出的 pane 高度——必须按实际 TabBar 高度扣减。
 */
describe('bottomChromeHeight', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('无 TabBar（桌面/平板/紧凑横屏/沉浸态）：预算为 0', () => {
    expect(bottomChromeHeight()).toBe(0)
  })

  it('渲染出的 TabBar：按实际高度扣减（含 safe-area 的 padding 在内）', () => {
    const bar = document.createElement('nav')
    bar.setAttribute('data-testid', 'app-tab-bar')
    bar.style.height = '56px'
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => ({ top: 788, height: 56, bottom: 844, left: 0, right: 390, width: 390 }),
    })
    document.body.appendChild(bar)
    expect(bottomChromeHeight()).toBe(56)
  })

  it('零高度 TabBar（隐藏/卸载中）：预算为 0，不扣出负空间', () => {
    const bar = document.createElement('nav')
    bar.setAttribute('data-testid', 'app-tab-bar')
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => ({ top: 844, height: 0, bottom: 844, left: 0, right: 390, width: 390 }),
    })
    document.body.appendChild(bar)
    expect(bottomChromeHeight()).toBe(0)
  })
})
