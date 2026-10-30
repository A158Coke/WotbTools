// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import RecorderReticle from './RecorderReticle.vue'

describe('RecorderReticle', () => {
  it('stays hidden until the scene writes a position, and never takes pointer input', () => {
    const wrapper = mount(RecorderReticle)
    const root = wrapper.get('[data-testid="recorder-reticle"]')
    expect(root.element.style.display).toBe('')
    wrapper.vm.update(120, 80, 36)
    expect(root.element.style.display).toBe('block')
    expect(root.element.style.transform).toBe('translate(120px, 80px)')
    expect(wrapper.get('.reticle-circle').attributes('r')).toBe('36')
    wrapper.vm.hide()
    expect(root.element.style.display).toBe('none')
  })
})
