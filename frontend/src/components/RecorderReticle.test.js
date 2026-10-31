// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import RecorderReticle from './RecorderReticle.vue'

describe('RecorderReticle', () => {
  it('stays hidden until written, then places the aim dot and gun circle independently', () => {
    const wrapper = mount(RecorderReticle)
    const root = wrapper.get('[data-testid="recorder-reticle"]')
    expect(root.element.style.display).toBe('')
    wrapper.vm.update({ x: 120, y: 80 }, { x: 200, y: 90 }, 36)
    expect(root.element.style.display).toBe('block')
    expect(wrapper.get('.reticle-center').attributes()).toMatchObject({ cx: '120', cy: '80' })
    expect(wrapper.get('.reticle-circle').attributes()).toMatchObject({ cx: '200', cy: '90', r: '36' })
    wrapper.vm.hide()
    expect(root.element.style.display).toBe('none')
  })

  it('hides only the part that cannot be projected', () => {
    const wrapper = mount(RecorderReticle)
    wrapper.vm.update(null, { x: 200, y: 90 }, 36)
    expect(wrapper.get('.reticle-center').element.style.display).toBe('none')
    expect(wrapper.get('.reticle-circle').element.style.display).toBe('')
  })

  it('stays hidden while UI is suppressed even if the scene keeps writing', async () => {
    const wrapper = mount(RecorderReticle, { props: { suppressed: true } })
    const root = wrapper.get('[data-testid="recorder-reticle"]')
    wrapper.vm.update({ x: 10, y: 20 }, { x: 10, y: 20 }, 30)
    expect(root.element.style.display).toBe('none')
    await wrapper.setProps({ suppressed: false })
    expect(root.element.style.display).toBe('block')
    await wrapper.setProps({ suppressed: true })
    expect(root.element.style.display).toBe('none')
  })
})
