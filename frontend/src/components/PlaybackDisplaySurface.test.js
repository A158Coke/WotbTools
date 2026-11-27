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
async function openSurface(hostRect, anchorRect, { transportRect, compact = false } = {}) {
  const host = document.createElement('div')
  const anchor = document.createElement('button')
  host.getBoundingClientRect = () => hostRect
  anchor.getBoundingClientRect = () => anchorRect
  if (transportRect) {
    const transport = document.createElement('div')
    transport.className = 'pb-transport-slot'
    transport.getBoundingClientRect = () => transportRect
    transport.appendChild(anchor)
  }
  if (compact) {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query === '(pointer: coarse) and (orientation: landscape) and (height <= 520px)',
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  }
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
  it('counts the panel borders in max-height so fitting content does not scroll', async () => {
    const { wrapper } = await openSurface(rect(20, 20, 600, 600), rect(570, 500, 44, 44))
    const panel = wrapper.get('section').element
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 282 })
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 280 })
    window.dispatchEvent(new Event('resize'))
    await wrapper.vm.$nextTick()
    expect(panel.style.maxHeight).toBe('470px')
  })

  it('stacks above the compact landscape transport bar instead of the gear', async () => {
    const { wrapper } = await openSurface(rect(0, 0, 844, 390), rect(700, 330, 36, 36), {
      transportRect: rect(0, 318, 844, 46),
      compact: true,
    })
    expect(wrapper.get('section').element.style.top).toBe('34px')
    expect(wrapper.get('section').element.style.maxHeight).toBe('306px')
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
    expect(document.activeElement).toBe(panel)

    await wrapper.setProps({ open: false })
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

})
