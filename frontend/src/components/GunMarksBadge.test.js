// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GunMarksBadge from './GunMarksBadge.vue'
import zh from '../locales/zh.json'
const mountBadge = props => mount(GunMarksBadge, { props, global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })] } })

describe('GunMarksBadge', () => {
  it('selects distinct one/two/three-chevron cells with localized accessible counts', async () => {
    const wrapper = mountBadge({ marks: 1 })
    const views = []
    for (const count of [1, 2, 3]) {
      await wrapper.setProps({ marks: count })
      expect(wrapper.get('svg').attributes('aria-label')).toBe(`${count} 环`)
      expect(wrapper.attributes('data-gun-marks')).toBe(String(count))
      views.push(wrapper.get('svg').attributes('viewBox'))
    }
    expect(new Set(views).size).toBe(3)
    await wrapper.setProps({ marks: null })
    expect(wrapper.find('svg').exists()).toBe(false)
    wrapper.unmount()
  })
  it('distinguishes explicit zero from unknown while withholding invalid badges', async () => {
    const wrapper = mountBadge({ marks: 0, showCount: true })
    expect(wrapper.text()).toBe('0 环')
    expect(wrapper.find('svg').exists()).toBe(false)
    for (const marks of [undefined, null, -1, 4, '2']) {
      await wrapper.setProps({ marks })
      expect(wrapper.text()).toBe('—')
      expect(wrapper.find('svg').exists()).toBe(false)
    }
    wrapper.unmount()
  })
})
