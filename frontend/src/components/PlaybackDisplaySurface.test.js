// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlaybackDisplaySurface from './PlaybackDisplaySurface.vue'

const wrappers = []
const containers = []
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
async function openSurface(hostRect, anchorRect) {
  const host = document.createElement('div')
  const anchor = document.createElement('button')
  host.getBoundingClientRect = () => hostRect
  anchor.getBoundingClientRect = () => anchorRect
  // 焦点断言要求真实在文档里（不在文档中的元素 focus() 不会成为 activeElement）。
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  const wrapper = mount(PlaybackDisplaySurface, {
    props: { host, anchor },
    slots: { default: '<label>Settings</label>' },
    global: { mocks: { $t: key => key } },
    attachTo: container,
  })
  wrappers.push(wrapper)
  await wrapper.setProps({ open: true })
  const panel = wrapper.get('section').element
  Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: 300 })
  Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 280 })
  window.dispatchEvent(new Event('resize'))
  await wrapper.vm.$nextTick()
  return { wrapper, anchor }
}
describe('PlaybackDisplaySurface', () => {
  it('opens above Gear and shifts left to stay inside workspace', async () => {
    const { wrapper } = await openSurface(rect(20, 20, 600, 600), rect(570, 500, 44, 44))
    expect(wrapper.get('section').element.style.left).toBe('292px')
    expect(wrapper.get('section').element.style.top).toBe('196px')
    expect(wrapper.get('section').element.style.maxHeight).toBe('468px')
  })
  it('uses the lower side when above has insufficient room', async () => {
    const { wrapper } = await openSurface(rect(20, 20, 600, 600), rect(200, 40, 44, 44))
    expect(wrapper.get('section').element.style.top).toBe('68px')
  })
  it('dismisses on Escape/outside while preserving anchor clicks', async () => {
    const { wrapper, anchor } = await openSurface(rect(20, 20, 600, 600), rect(200, 400, 44, 44))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(2)
    document.body.appendChild(anchor)
    anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(2)
    anchor.remove()
    await wrapper.setProps({ portrait: true })
    expect(wrapper.get('section').classes()).toContain('pb-display-portrait')
    expect(wrapper.get('section').attributes('style') || '').not.toContain('left:')
  })

  it('moves focus into the surface on open and does not hand focus to an invisible Gear', async () => {
    const { wrapper, anchor } = await openSurface(rect(20, 20, 600, 600), rect(200, 400, 44, 44))
    const panel = wrapper.get('section').element
    expect(panel.getAttribute('tabindex')).toBe('-1')
    // 面内没有可聚焦控件（只有插槽内容）时，落点退回面本身——键盘用户不会掉在面外。
    expect(document.activeElement).toBe(panel)

    await wrapper.setProps({ open: false })
    // gear 在本用例里没有布局尺寸（happy-dom 下 0×0），按「不给看不见的落点」约定不搬焦点。
    expect(document.activeElement).not.toBe(panel)
    expect(anchor.getAttribute('tabindex')).toBeNull()
  })

  it('is a labelled dialog with a programmatic focus target', async () => {
    const { wrapper } = await openSurface(rect(20, 20, 600, 600), rect(200, 400, 44, 44))
    const panel = wrapper.get('section')
    expect(panel.attributes('role')).toBe('dialog')
    expect(panel.attributes('tabindex')).toBe('-1')
    expect(panel.attributes('aria-label')).toBe('recon.map.playback.panel_display')
  })

  // 「面内有明确关闭入口时优先把落点给它」这条规则用尺寸判定可见性，而 jsdom / happy-dom 不跑
  // 布局（所有元素都是 0×0），所以这里只能锁「没有可聚焦内容时退回面本身」；有内容时优先关按钮
  // 与关闭后回到 gear 由真实浏览器门禁 `ws2d-*` 断言（那里有真实几何）。
})
