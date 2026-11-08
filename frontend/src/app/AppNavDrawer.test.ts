// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRoute: () => ({ fullPath: '/' }) }))

import AppNavDrawer from './AppNavDrawer.vue'

const AppSheetStub = defineComponent({
  name: 'AppSheet',
  props: { open: Boolean, portalTo: { type: Object, default: null } },
  setup: (props, { slots }) => () => h('div', { 'data-portal': props.portalTo ? (props.portalTo as HTMLElement).id : 'body' }, slots.default?.()),
})

function setFullscreen(element: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
  document.dispatchEvent(new Event('fullscreenchange'))
}

afterEach(() => setFullscreen(null))

describe('AppNavDrawer', () => {
  it('原生全屏时把抽屉渲染进全屏元素，退出全屏后回到 body', async () => {
    const root = document.createElement('div')
    root.id = 'playback-root'
    document.body.append(root)
    const wrapper = mount(AppNavDrawer, {
      props: { open: false },
      global: { stubs: { AppSheet: AppSheetStub, AppSidebar: true }, mocks: { $t: (key: string) => key } },
    })
    setFullscreen(root)
    await wrapper.setProps({ open: true })
    await nextTick()
    expect(wrapper.get('[data-portal]').attributes('data-portal')).toBe('playback-root')
    setFullscreen(null)
    await nextTick()
    expect(wrapper.get('[data-portal]').attributes('data-portal')).toBe('body')
    wrapper.unmount()
    root.remove()
  })

  it('点击抽屉里的导航链接即关闭（含当前页：路由不变也要收起）', async () => {
    const SidebarStub = defineComponent({ setup: () => () => h('nav', [h('a', { href: '/?view=replay', 'data-test': 'link' }, 'Replay'), h('span', { 'data-test': 'label' }, 'group')]) })
    const wrapper = mount(AppNavDrawer, {
      props: { open: true },
      global: { stubs: { AppSheet: AppSheetStub, AppSidebar: SidebarStub }, mocks: { $t: (key: string) => key } },
    })
    await wrapper.get('[data-test="label"]').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.get('[data-test="link"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
