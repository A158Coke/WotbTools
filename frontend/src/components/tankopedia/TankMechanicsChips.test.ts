// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TankMechanicsChips from './TankMechanicsChips.vue'
import { DIALOG_INLINE_KEY } from '../../shared/dialog.js'
import { messages } from '../../locales/messages.js'

type MechanicRow = { name: string; title?: string | null; description?: string | null }

function chips(mechanics: MechanicRow[], locale = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  return mount(TankMechanicsChips, {
    props: { mechanics },
    global: { plugins: [i18n], provide: { [DIALOG_INLINE_KEY]: true } },
  })
}

describe('TankMechanicsChips（详情头卡机制标签）', () => {
  it('默认只显示机制名称；点击后弹窗显示官方说明（占位符已替换）', async () => {
    const wrapper = chips([
      {
        name: 'TrayShell',
        title: 'Assault Shells',
        description: 'Damage depends on distance.\n• 50 m or less: x 140%',
      },
      { name: 'ImprovedDetection', title: 'Tracer Shells', description: 'Makes an enemy visible.' },
    ])
    const strip = wrapper.get('[data-testid=tank-mechanics]')
    expect(strip.text()).toContain('Assault Shells')
    expect(strip.text()).toContain('Tracer Shells')
    expect(strip.text()).not.toContain('Damage depends on distance')
    expect(wrapper.find('[data-testid=tank-mechanic-dialog]').exists()).toBe(false)

    await wrapper.get('[data-testid=tank-mechanic-TrayShell]').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[data-testid=tank-mechanic-dialog]')
    expect(dialog.text()).toContain('Assault Shells')
    expect(dialog.text()).toContain('Damage depends on distance.')
    expect(dialog.text()).toContain('x 140%')
    expect(dialog.text()).not.toContain('%(ParamName')
  })

  it('缺说明时弹窗显示本地化提示（不显示原始 key）', async () => {
    const wrapper = chips([{ name: 'TrayShell', title: null, description: null }], 'zh')
    const chip = wrapper.get('[data-testid=tank-mechanic-TrayShell]')
    expect(chip.text()).toBe('TrayShell')
    await chip.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid=tank-mechanic-dialog]').text())
      .toContain(messages.zh.agentTanks.mechanics.description_unavailable)
  })

  it('无机制不渲染标签行', () => {
    const wrapper = chips([])
    expect(wrapper.find('[data-testid=tank-mechanics]').exists()).toBe(false)
  })
})