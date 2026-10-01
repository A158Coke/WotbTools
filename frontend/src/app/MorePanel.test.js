// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MorePanel from './MorePanel.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({ isAdmin: { value: false }, isHofAdmin: { value: false } }),
}))

function mountPanel(navigate = vi.fn()) {
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const wrapper = mount(MorePanel, {
    attachTo: document.body,
    props: { open: false, anchor, id: 'p' },
    global: {
      provide: { [DIALOG_INLINE_KEY]: true, [NAVIGATE_VIEW_KEY]: navigate },
      mocks: { $t: key => key, $i18n: { locale: 'zh' } },
    },
  })
  return { wrapper, anchor, navigate }
}

describe('MorePanel', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('点面板外关闭，点触发按钮不算"外部"', async () => {
    const { wrapper, anchor } = mountPanel()
    await wrapper.setProps({ open: true })
    anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toBeUndefined()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('焦点移出面板时关闭；在面板内移动不关闭', async () => {
    const { wrapper } = mountPanel()
    await wrapper.setProps({ open: true })
    const panel = wrapper.get('[data-testid="more-panel"]')
    const inside = panel.findAll('button')[1].element
    await panel.trigger('focusout', { relatedTarget: inside })
    expect(wrapper.emitted('close')).toBeUndefined()
    const outside = document.createElement('a')
    document.body.appendChild(outside)
    await panel.trigger('focusout', { relatedTarget: outside })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('选一个链接：导航并关闭', async () => {
    const { wrapper, navigate } = mountPanel()
    await wrapper.setProps({ open: true })
    await wrapper.get('[data-testid="more-link-contact"]').trigger('click')
    expect(navigate).toHaveBeenCalledWith('contact')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
