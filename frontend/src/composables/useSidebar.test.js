// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useSidebar：桌面侧边栏折叠偏好', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.documentElement.removeAttribute('data-sidebar')
  })

  it('默认展开，并把状态写到 <html data-sidebar>', async () => {
    const { useSidebar } = await import('./useSidebar.js')
    expect(useSidebar().collapsed.value).toBe(false)
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('expanded')
  })

  it('折叠后持久化，重新加载仍是折叠', async () => {
    const first = await import('./useSidebar.js')
    first.useSidebar().toggle()
    expect(localStorage.getItem('wotb-sidebar')).toBe('collapsed')
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('collapsed')

    vi.resetModules()
    const second = await import('./useSidebar.js')
    expect(second.useSidebar().collapsed.value).toBe(true)
  })
})
