// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlaybackDisplaySurface from './PlaybackDisplaySurface.vue'

const wrappers = []
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
async function openSurface(hostRect, anchorRect) {
  const host = document.createElement('div')
  const anchor = document.createElement('button')
  host.getBoundingClientRect = () => hostRect
  anchor.getBoundingClientRect = () => anchorRect
  const wrapper = mount(PlaybackDisplaySurface, { props: { host, anchor }, slots: { default: '<label>Settings</label>' }, global: { mocks: { $t: key => key } } })
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
})
