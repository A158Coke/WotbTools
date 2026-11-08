// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ThemePicker from './ThemePicker.vue'
import { UI_PROFILE_STORAGE_KEY, setUiProfile, uiProfile } from '../composables/useUiProfile.js'

function mountPicker() {
  return mount(ThemePicker, { props: { ariaLabel: 'Theme' }, global: { mocks: { $t: (key: string) => key } } })
}

afterEach(() => {
  setUiProfile('summer')
  window.localStorage.removeItem(UI_PROFILE_STORAGE_KEY)
})

describe('ThemePicker', () => {
  it('是一组四季单选项，选中项反映已保存的主题', () => {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, 'autumn')
    const wrapper = mountPicker()
    const radios = wrapper.findAll('[role=radio]')
    expect(radios.map(radio => radio.attributes('data-value'))).toEqual(['spring', 'summer', 'autumn', 'winter'])
    expect(wrapper.get('[data-value=autumn]').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-value=autumn]').text()).toContain('uiProfile.autumn')
    wrapper.unmount()
  })

  it('点选即切换主题并持久化，不重建组件', async () => {
    const wrapper = mountPicker()
    const root = wrapper.element
    await wrapper.get('[data-value=winter]').trigger('click')
    expect(uiProfile.value).toBe('winter')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('winter')
    expect(wrapper.element).toBe(root)
    wrapper.unmount()
  })
})
