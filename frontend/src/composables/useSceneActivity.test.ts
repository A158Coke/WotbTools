// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useSceneActivity } from './useSceneActivity'

describe('useSceneActivity', () => {
  it('combines owner, visibility and page lifecycle and removes listeners', async () => {
    let visibility: DocumentVisibilityState = 'hidden'
    const getter = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const active = ref(true)
    const wrapper = mount(defineComponent({
      setup() { const running = useSceneActivity(() => active.value); return () => h('span', String(running.value)) },
    }))
    expect(wrapper.text()).toBe('false')
    visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); await nextTick()
    expect(wrapper.text()).toBe('true')
    window.dispatchEvent(new Event('pagehide')); await nextTick()
    expect(wrapper.text()).toBe('false')
    active.value = false; window.dispatchEvent(new Event('pageshow')); await nextTick()
    expect(wrapper.text()).toBe('false')
    active.value = true; await nextTick()
    expect(wrapper.text()).toBe('true')
    const removeDoc = vi.spyOn(document, 'removeEventListener')
    const removeWin = vi.spyOn(window, 'removeEventListener')
    wrapper.unmount()
    expect(removeDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeWin).toHaveBeenCalledWith('pagehide', expect.any(Function))
    expect(removeWin).toHaveBeenCalledWith('pageshow', expect.any(Function))
    removeDoc.mockRestore(); removeWin.mockRestore(); getter.mockRestore()
  })
})
