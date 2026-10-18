// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import LeagueBroadcastReplayDialog from './LeagueBroadcastReplayDialog.vue'
import type { BroadcastCategory, BroadcastNode, BroadcastReplay, BroadcastSeason } from '../api/league-broadcasts.js'

const season: BroadcastSeason = { id: 1, server: 'CN', year: 2026, nameZh: '夏季赛', nameEn: 'Summer', nameRu: null, startDate: null, createdAt: '2026-10-16T12:00:00Z', version: 4, rootCount: 1, replayCount: 0 }
const category: BroadcastCategory = { id: 2, seasonId: 1, type: 'POINTS' }
const node: BroadcastNode = { id: 3, categoryId: 2, roundNumber: 1, format: null, replays: [] }
const existing: BroadcastReplay = { startsAt: null, id: 5, nodeId: 3, title: 'Existing', url: 'https://example.org/watch', matchDate: '2026-10-16', dayNumber: 7,
  groupNumber: 7, bracket: null, teams: ['Followed', 'Other'], perspective: 'POV', coverId: '493199ec-c421-456b-a865-dcd69ef4c62a' }
let wrappers: ReturnType<typeof mount>[] = []
function dialog(type: BroadcastCategory['type'] = 'POINTS', format: BroadcastNode['format'] = null, replay: BroadcastReplay | null = null, uploads = true) {
  const wrapper = mount(LeagueBroadcastReplayDialog, { props: { open: true, season, defaultTimeZone: 'Asia/Shanghai', category: { ...category, type }, node: { ...node, format }, replay, busy: false, coverUploadAvailable: uploads },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true } } })
  wrappers.push(wrapper)
  return wrapper
}
async function fill(wrapper: ReturnType<typeof dialog>) {
  await wrapper.get('[data-testid=broadcast-title]').setValue('Final')
  await wrapper.get('[data-testid=broadcast-url]').setValue('https://example.org/video')
  await wrapper.get('[data-testid=broadcast-date]').setValue('2026-10-16')
  await wrapper.get('[data-testid=broadcast-day]').setValue('7')
  await wrapper.get('[data-testid=broadcast-team-0]').setValue('Followed')
  await wrapper.get('[data-testid=broadcast-team-1]').setValue('Other')
  if (wrapper.find('input[data-testid=broadcast-group-number]').exists()) await wrapper.get('[data-testid=broadcast-group-number]').setValue('7')
}
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:cover-preview')
    static revokeObjectURL = vi.fn()
  })
})
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers = []; vi.unstubAllGlobals() })

describe('broadcast replay form inheritance and fields', () => {
  it('defaults admin input to UTC+8, preserves the instant when switching offsets and derives the server match date', async () => {
    const wrapper = dialog('POINTS', null, { ...existing, matchDate: '2026-08-16', startsAt: '2026-08-17T01:00:37.123456Z' })
    await wrapper.setProps({ defaultTimeZone: 'America/Los_Angeles' })
    expect((wrapper.get('[data-testid=broadcast-date]').element as HTMLInputElement).value).toBe('2026-08-17')
    expect((wrapper.get('[data-testid=broadcast-time]').element as HTMLInputElement).value).toBe('09:00:37.123')
    expect((wrapper.get('[data-testid=broadcast-input-time-zone]').element as HTMLSelectElement).value).toBe('480')
    await wrapper.get('[data-testid=broadcast-input-time-zone]').setValue('-420')
    expect((wrapper.get('[data-testid=broadcast-date]').element as HTMLInputElement).value).toBe('2026-08-16')
    expect((wrapper.get('[data-testid=broadcast-time]').element as HTMLInputElement).value).toBe('18:00:37.123')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![0][0]).toMatchObject({ startsAt: '2026-08-17T01:00:37.123456Z', replay: { matchDate: '2026-08-16' } })
    await wrapper.get('[data-testid=broadcast-time]').setValue('')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![1][0]).toMatchObject({ startsAt: null, replay: { matchDate: '2026-08-16' } })
    await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true })
    expect((wrapper.get('[data-testid=broadcast-input-time-zone]').element as HTMLSelectElement).value).toBe('480')
  })
  it('keeps date-only editing unchanged when switching the input offset', async () => {
    const wrapper = dialog('POINTS', null, existing)
    await wrapper.get('[data-testid=broadcast-input-time-zone]').setValue('-480')
    expect((wrapper.get('[data-testid=broadcast-date]').element as HTMLInputElement).value).toBe(existing.matchDate)
    expect((wrapper.get('[data-testid=broadcast-time]').element as HTMLInputElement).value).toBe('')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![0][0]).toMatchObject({ startsAt: null, replay: { matchDate: existing.matchDate } })
  })
  it.each([
    ['America/Los_Angeles', '2026-08-17T01:00:00Z'],
    ['Europe/Berlin', '2026-08-16T20:00:00Z'],
  ])('preserves the %s server day when only clearing time in the default UTC+8 editor', async (defaultTimeZone, startsAt) => {
    const wrapper = dialog('POINTS', null, { ...existing, matchDate: '2026-08-16', startsAt })
    await wrapper.setProps({ defaultTimeZone })
    expect((wrapper.get('[data-testid=broadcast-date]').element as HTMLInputElement).value).toBe('2026-08-17')
    await wrapper.get('[data-testid=broadcast-time]').setValue('')
    expect((wrapper.get('[data-testid=broadcast-date]').element as HTMLInputElement).value).toBe('2026-08-16')
    await wrapper.get('[data-testid=broadcast-input-time-zone]').setValue('-420')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![0][0]).toMatchObject({ startsAt: null, replay: { matchDate: '2026-08-16' } })
    await wrapper.get('[data-testid=broadcast-date]').setValue('2026-08-18')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![1][0]).toMatchObject({ startsAt: null, replay: { matchDate: '2026-08-18' } })
  })
  it('keeps a date explicitly edited before removing the clock time', async () => {
    const wrapper = dialog('POINTS', null, { ...existing, matchDate: '2026-08-16', startsAt: '2026-08-17T01:00:00Z' })
    await wrapper.setProps({ defaultTimeZone: 'America/Los_Angeles' })
    await wrapper.get('[data-testid=broadcast-date]').setValue('2026-08-18')
    await wrapper.get('[data-testid=broadcast-time]').setValue('')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![0][0]).toMatchObject({ startsAt: null, replay: { matchDate: '2026-08-18' } })
  })
  it.each([
    ['POINTS', null, true, false], ['QUARTER_FINALS', 'ROUND_ROBIN', false, false],
    ['QUARTER_FINALS', 'KNOCKOUT', false, true], ['SEMI_FINALS', null, false, true],
  ] as const)('selects only fields applicable to %s / %s', async (type, format, points, grouped) => {
    const wrapper = dialog(type, format)
    expect(wrapper.find('input[data-testid=broadcast-group-number]').exists()).toBe(points)
    expect(wrapper.find('select[data-testid=broadcast-group-number]').exists()).toBe(grouped)
    expect(wrapper.find('[data-testid=broadcast-bracket]').exists()).toBe(grouped)
    expect(wrapper.find('[data-testid=broadcast-node-round]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=broadcast-node-format]').exists()).toBe(false)
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    const value = (wrapper.emitted('save')![0][0] as any).replay
    expect(value).toMatchObject({ expectedVersion: 4, dayNumber: 7, matchDate: '2026-10-16', teams: ['Followed', 'Other'],
      groupNumber: points ? 7 : null, bracket: grouped ? 'DEFAULT' : null, coverAction: 'KEEP' })
    expect(value).not.toHaveProperty('groupLabel')
    if (points) expect(wrapper.get('[data-testid=broadcast-replay-context]').text()).toContain('第 1 轮积分赛')
    expect(wrapper.get('[data-testid=broadcast-replay-context]').text()).toContain('第 7 天')
  })
  it.each(['0', '-1', '1.5', '2147483648'])('rejects invalid points group number %s', async group => {
    const wrapper = dialog()
    await fill(wrapper)
    await wrapper.get('[data-testid=broadcast-group-number]').setValue(group)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeUndefined()
  })
  it.each(['5', '2147483647'])('allows points group number %s beyond the knockout range', async group => {
    const wrapper = dialog()
    await fill(wrapper)
    const input = wrapper.get('[data-testid=broadcast-group-number]')
    expect(input.attributes()).toMatchObject({ type: 'number', min: '1', max: '2147483647', step: '1' })
    await input.setValue(group)
    await wrapper.get('form').trigger('submit')
    expect((wrapper.emitted('save')![0][0] as any).replay).toMatchObject({ groupNumber: Number(group), bracket: null })
  })
  it('allows a blank group and an explicit numeric group on the same record', async () => {
    const wrapper = dialog('POINTS', null, { ...existing, groupNumber: null })
    const input = wrapper.get('[data-testid=broadcast-group-number]')
    expect((input.element as HTMLInputElement).value).toBe('')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![0][0]).toMatchObject({ replay: { groupNumber: null } })
    await input.setValue('12')
    await wrapper.get('form').trigger('submit')
    expect((wrapper.emitted('save')![1][0] as any).replay).toMatchObject({ groupNumber: 12 })
  })
  it.each([['QUARTER_FINALS', 'KNOCKOUT'], ['SEMI_FINALS', null]] as const)('keeps %s groups restricted to 1 through 4', async (type, format) => {
    const wrapper = dialog(type, format)
    await fill(wrapper)
    const input = wrapper.get('[data-testid=broadcast-group-number]')
    expect(input.findAll('option').map(option => option.attributes('value'))).toEqual(['', '1', '2', '3', '4'])
    const option = document.createElement('option'); option.value = '5'; option.textContent = '5'
    input.element.appendChild(option)
    await input.setValue('5')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeUndefined()
    await input.setValue('4')
    await wrapper.get('form').trigger('submit')
    expect((wrapper.emitted('save')![0][0] as any).replay).toMatchObject({ groupNumber: 4, bracket: 'DEFAULT' })
  })
  it('requires both first teams and accepts up to four teams without a knockout-specific limit', async () => {
    const wrapper = dialog('SEMI_FINALS')
    await fill(wrapper)
    await wrapper.get('[data-testid=broadcast-team-1]').setValue(' ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeUndefined()
    await wrapper.get('[data-testid=broadcast-team-1]').setValue('Other')
    await wrapper.get('[data-testid=broadcast-team-2]').setValue('Third')
    await wrapper.get('[data-testid=broadcast-team-3]').setValue('Fourth')
    await wrapper.get('form').trigger('submit')
    expect(((wrapper.emitted('save')![0][0] as any).replay).teams).toEqual(['Followed', 'Other', 'Third', 'Fourth'])
  })
  it('preserves or explicitly removes an existing cover without re-uploading it', async () => {
    const wrapper = dialog('POINTS', null, existing, false)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![0].slice(0, 2)).toEqual([expect.objectContaining({ replay: expect.objectContaining({ coverAction: 'KEEP' }) }), null])
    await wrapper.get('[data-testid=broadcast-remove-cover]').trigger('click')
    await wrapper.get('form').trigger('submit')
    expect((wrapper.emitted('save')![1][0] as any).replay).toMatchObject({ coverAction: 'REMOVE' })
  })
  it('uploads only with Save and releases a selected image preview when cancelled', async () => {
    const wrapper = dialog()
    const file = new File(['png'], 'cover.png', { type: 'image/png' })
    const input = wrapper.get('[data-testid=tournament-image-input]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change'); await flushPromises()
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[data-testid=broadcast-cover-preview]').attributes('src')).toBe('blob:cover-preview')
    await wrapper.setProps({ open: false }); await flushPromises()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-preview')
  })
})
