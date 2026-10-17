// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, nextTick, ref } from 'vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import { messages } from '../locales/messages.js'
import type { TournamentEvent } from '../api/tournament-points.js'

function picker(initial: number | null = 7, includeGlobal = false) {
  const events: TournamentEvent[] = [
    { id: 7, version: 1, year: 2026, region: 'CN', season: 'SUMMER', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false },
    { id: 8, version: 1, year: 2025, region: 'EU', season: 'FIRE_CUP', roundCount: 4, daysPerRound: 3, dayLabels: ['Day 1', 'Day 2', 'Day 3'], configLocked: false },
  ]
  const model = ref<number | null>(initial)
  const loadedEvents = ref(events)
  const globalSelected = ref(false)
  const host = defineComponent({
    setup: () => () => h(TournamentEventSelect, {
      events: loadedEvents.value, modelValue: model.value, includeGlobal, globalSelected: globalSelected.value,
      'onSelect-global': () => { globalSelected.value = true },
      'onUpdate:modelValue': (value: number | null) => { globalSelected.value = false; model.value = value },
    }),
  })
  const wrapper = mount(host, { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] } })
  const values = () => wrapper.findAll('select').map(select => (select.element as HTMLSelectElement).value)
  return { globalSelected, wrapper, model, loadedEvents, events, values }
}

describe('controlled tournament event selection', () => {
  it('lists seasons in the specified calendar order independently of API response order', async () => {
    const p = picker()
    p.loadedEvents.value = ['WINTER', 'FIRE_CUP', 'AUTUMN', 'SUMMER', 'SPRING'].map((season, index) => ({
      ...p.events[0], id: index + 20, season: season as TournamentEvent['season'],
    }))
    p.model.value = 20
    await nextTick()
    expect(p.wrapper.get('[data-testid="event-season"]').findAll('option').map(option => option.attributes('value')))
      .toEqual(['', 'SPRING', 'SUMMER', 'AUTUMN', 'FIRE_CUP', 'WINTER'])
    p.wrapper.unmount()
  })
  it('clears displayed fields when the owner resets the selected event', async () => {
    const p = picker()
    expect(p.values()).toEqual(['2026', 'CN', 'SUMMER'])
    p.model.value = null
    await nextTick()
    expect(p.values()).toEqual(['', '', ''])
    expect(p.wrapper.get('[data-testid="event-region"]').attributes('disabled')).toBeDefined()
    expect(p.wrapper.get('[data-testid="event-season"]').attributes('disabled')).toBeDefined()
  })

  it('clears fields when the model references an unmatched event', async () => {
    const p = picker()
    p.model.value = 999
    await nextTick()
    expect(p.values()).toEqual(['', '', ''])
  })

  it('clears a deleted event and populates a model when its events arrive', async () => {
    const p = picker()
    p.loadedEvents.value = p.events.filter(event => event.id !== 7)
    await nextTick()
    expect(p.values()).toEqual(['', '', ''])
    p.loadedEvents.value = p.events
    await nextTick()
    expect(p.values()).toEqual(['2026', 'CN', 'SUMMER'])
  })

  it('preserves local partial filters while switching to a different event', async () => {
    const p = picker()
    await p.wrapper.get('[data-testid="event-year"]').setValue('2025')
    expect(p.model.value).toBeNull()
    expect(p.values()).toEqual(['2025', '', ''])
    await p.wrapper.get('[data-testid="event-region"]').setValue('EU')
    expect(p.values()).toEqual(['2025', 'EU', ''])
    await p.wrapper.get('[data-testid="event-season"]').setValue('FIRE_CUP')
    expect(p.model.value).toBe(8)
    expect(p.values()).toEqual(['2025', 'EU', 'FIRE_CUP'])
    p.model.value = null
    await nextTick()
    expect(p.values()).toEqual(['', '', ''])
  })

  it('keeps initial year-first selection usable before any event is selected', async () => {
    const p = picker(null)
    await p.wrapper.get('[data-testid="event-year"]').setValue('2026')
    await p.wrapper.get('[data-testid="event-region"]').setValue('CN')
    await p.wrapper.get('[data-testid="event-season"]').setValue('SUMMER')
    expect(p.model.value).toBe(7)
    expect(p.values()).toEqual(['2026', 'CN', 'SUMMER'])
  })
})

describe('optional global configuration selection', () => {
  it('offers global rules without year/region and exits to ordinary filters without inventing event ids', async () => {
    const p = picker(null, true)
    const seasons = p.wrapper.get('[data-testid="event-season"]')
    expect(seasons.attributes('disabled')).toBeUndefined()
    await seasons.setValue('GLOBAL')
    expect(p.globalSelected.value).toBe(true); expect(p.model.value).toBeNull()
    expect(p.values()).toEqual(['', '', 'GLOBAL'])
    await p.wrapper.get('[data-testid="event-year"]').setValue('2026')
    expect(p.globalSelected.value).toBe(false)
    expect(p.values()).toEqual(['2026', '', ''])
    await p.wrapper.get('[data-testid="event-region"]').setValue('CN')
    await seasons.setValue('SUMMER')
    expect(p.model.value).toBe(7)
    p.wrapper.unmount()
  })
  it('preserves ordinary choices while global is selected and refreshed events arrive', async () => {
    const p = picker(7, true)
    await p.wrapper.get('[data-testid="event-season"]').setValue('GLOBAL')
    p.loadedEvents.value = [...p.events]; await nextTick()
    expect(p.values()).toEqual(['2026', 'CN', 'GLOBAL'])
    await p.wrapper.get('[data-testid="event-season"]').setValue('SUMMER')
    expect(p.globalSelected.value).toBe(false)
    expect(p.model.value).toBe(7)
    expect(p.values()).toEqual(['2026', 'CN', 'SUMMER'])
    p.wrapper.unmount()
  })
})
