// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import TournamentPointsConfigPage from './TournamentPointsConfigPage.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'

const state = vi.hoisted(() => ({ list: vi.fn(), config: vi.fn(), defaults: vi.fn(), source: vi.fn(), set: vi.fn(), clear: vi.fn(), saveGlobal: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('../api/tournament-points.js', async original => ({ ...await original<object>(),
  listTournamentEvents: state.list, getTournamentConfig: state.config, getTournamentDefaultRules: state.defaults,
  getTournamentRuleSource: state.source, setTournamentDefaultRules: state.set, clearTournamentDefaultRules: state.clear,
  saveTournamentDefaultConfiguration: state.saveGlobal, createTournament: state.create, updateTournament: state.update,
}))
vi.mock('../composables/useAuth.js', async original => {
  const { ref } = await import('vue')
  return { ...await original<object>(), useAuth: () => ({ authenticated: ref(true), tokenParsed: ref({ sub: 'admin', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => 1 }) }
})
const event = { id: 7, version: 1, year: 2026, region: 'CN', season: 'SUMMER', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false }
const config = { event, clans: [], rounds: Array.from({ length: 5 }, (_, i) => ({ roundNumber: i + 1, rulesVersion: 1, locked: false, complete: true,
  days: [1, 2].map(dayNumber => ({ dayNumber, points: [1, 2, 3, 4].map(rank => ({ rank, points: rank * 100 })) })) })) }
const defaults = { version: 2, active: true, sourceEventId: null, sourceLabel: '2026 FIRE_CUP', updatedAt: null, rounds: config.rounds }
beforeEach(() => {
  vi.clearAllMocks()
  state.list.mockResolvedValue([event]); state.config.mockResolvedValue(config); state.defaults.mockResolvedValue(defaults)
  state.source.mockResolvedValue({ eventVersion: 1, source: 'INHERIT', defaultVersion: 2, isDefaultSource: false, defaultOutdated: false })
})
async function page(selected = true) {
  const wrapper = mount(TournamentPointsConfigPage, { global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: messages as Record<string, any> })], stubs: { RouterLink: true }, provide: { [DIALOG_INLINE_KEY]: true } } })
  await flushPromises()
  if (selected) { wrapper.findComponent(TournamentEventSelect).vm.$emit('update:modelValue', 7); await flushPromises() }
  return wrapper
}
describe('default rules administrator controls', () => {
  it('renders a committed-state switch, exact replacement copy, and a harmless cancel', async () => {
    const wrapper = await page()
    const toggle = wrapper.get('[role="switch"]')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('设为全局默认配置')
    await toggle.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="default-rules-dialog"]').text()).toContain('当前已有默认的积分规则配置，是否更新默认配置？')
    expect(wrapper.get('[data-testid="confirm-default-rules"]').text()).toBe('是，继续更新')
    await wrapper.get('[data-testid="cancel-default-rules"]').trigger('click')
    expect(wrapper.find('[data-testid="default-rules-dialog"]').exists()).toBe(false)
    expect(state.set).not.toHaveBeenCalled()
    expect(toggle.attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })
  it('keeps a failed replacement unchecked and shows the failure in its open dialog', async () => {
    const wrapper = await page()
    state.set.mockRejectedValue({ errorCode: 'TOURNAMENT_VERSION_CONFLICT' })
    await wrapper.get('[role="switch"]').trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="confirm-default-rules"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.get('[data-testid="confirm-default-rules"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="default-rules-dialog"]').text()).toContain('刷新')
    wrapper.unmount()
  })
  it('blocks publishing dirty cells and provides an explicit update for a changed source', async () => {
    state.defaults.mockResolvedValue({ ...defaults, sourceEventId: 7 })
    state.source.mockResolvedValue({ eventVersion: 1, source: 'CUSTOM', defaultVersion: null, isDefaultSource: true, defaultOutdated: true })
    const wrapper = await page()
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-testid="update-default-rules"]').text()).toBe('更新默认配置')
    await wrapper.get('[data-testid="rule-1-1"]').setValue('777')
    expect(wrapper.get('[data-testid="update-default-rules"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('有未保存的修改')
    wrapper.unmount()
  })
  it('allows clearing an initialized default without selecting its source event', async () => {
    const wrapper = await page(false)
    expect(wrapper.get('[role="switch"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="clear-default-rules"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="default-rules-dialog"]').text()).toContain('未开始统计')
    state.clear.mockResolvedValue({ ...defaults, version: 3, active: false, rounds: [] })
    await wrapper.get('[data-testid="confirm-default-rules"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="clear-default-rules"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('尚未设置全局默认配置')
    wrapper.unmount()
  })
})

describe('global configuration editor', () => {
  it('locks the lower season field, edits every round, and saves globally without creating an event', async () => {
    const wrapper = await page(false)
    await wrapper.get('[data-testid="event-season"]').setValue('GLOBAL'); await flushPromises()
    expect(wrapper.get('[data-testid="config-season"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="config-season"]').text()).toBe('全局默认配置')
    expect(wrapper.find('[data-testid="config-year"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('当前默认来源')
    expect(wrapper.get('[data-testid="save-round-rules"]').text()).toBe('保存全局默认规则')
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    await wrapper.get('[data-testid="rule-1-1"]').setValue('700')
    await wrapper.get('[data-testid="rules-round"]').setValue('2')
    await wrapper.get('[data-testid="rule-2-1"]').setValue('800')
    await wrapper.get('[data-testid="rules-round"]').setValue('1')
    expect((wrapper.get('[data-testid="rule-1-1"]').element as HTMLInputElement).value).toBe('700')
    state.saveGlobal.mockImplementation(async request => ({ ...defaults, version: 3, rounds: request.rounds }))
    await wrapper.get('[data-testid="save-round-rules"]').trigger('submit'); await flushPromises()
    expect(wrapper.get('[data-testid="default-rules-dialog"]').text()).toContain('当前已有默认的积分规则配置，是否更新默认配置？')
    await wrapper.get('[data-testid="confirm-default-rules"]').trigger('click'); await flushPromises()
    const request = state.saveGlobal.mock.calls[0][0]
    expect(request.rounds[0].days[0].points[0].points).toBe(700)
    expect(request.rounds[1].days[1].points[0].points).toBe(800)
    expect(state.create).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('exits global mode through the existing year/region/season selector', async () => {
    const wrapper = await page(false)
    await wrapper.get('[data-testid="event-season"]').setValue('GLOBAL'); await flushPromises()
    await wrapper.get('[data-testid="event-year"]').setValue('2026'); await flushPromises()
    await wrapper.get('[data-testid="event-region"]').setValue('CN'); await flushPromises()
    await wrapper.get('[data-testid="event-season"]').setValue('SUMMER'); await flushPromises()
    expect((wrapper.get('[data-testid="config-season"]').element as HTMLSelectElement).value).toBe('SUMMER')
    expect(wrapper.get('[data-testid="config-season"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="save-round-rules"]').text()).toBe('保存本轮规则')
    wrapper.unmount()
  })
})
