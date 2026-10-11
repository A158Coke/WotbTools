// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import MorePanel from './MorePanel.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'

const authState = vi.hoisted(() => ({ authenticated: null }))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({ isAdmin: { value: false }, isHofAdmin: { value: false }, isTournamentAdmin: { value: false }, authenticated: authState.authenticated }),
}))

function mountPanel(navigate = vi.fn(), onboarding = null) {
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  const wrapper = mount(MorePanel, {
    attachTo: document.body,
    props: { open: false, anchor, id: 'p' },
    global: {
      provide: { [DIALOG_INLINE_KEY]: true, [NAVIGATE_VIEW_KEY]: navigate, [ONBOARDING_KEY]: onboarding },
      mocks: { $t: key => key, $i18n: { locale: 'zh' } },
    },
  })
  return { wrapper, anchor, navigate }
}

describe('MorePanel', () => {
  beforeEach(() => { authState.authenticated = ref(false) })
  afterEach(() => { document.body.innerHTML = '' })
  it('keeps anonymous guide entries hidden and enables them reactively after sign-in', async () => {
    const openDirectory = vi.fn()
    const { wrapper } = mountPanel(vi.fn(), { openDirectory })
    await wrapper.setProps({ open: true })
    expect(wrapper.find('[data-testid="more-link-guide"]').exists()).toBe(false)
    authState.authenticated.value = true
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="more-link-guide"]').trigger('click')
    expect(openDirectory).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    authState.authenticated.value = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="more-link-guide"]').exists()).toBe(false)
    wrapper.unmount()
  })

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
    expect(wrapper.find('#more-panel-tools').exists()).toBe(false)
    expect(navigate).toHaveBeenCalledWith('contact')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
