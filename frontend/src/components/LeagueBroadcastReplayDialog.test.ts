// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import LeagueBroadcastReplayDialog from './LeagueBroadcastReplayDialog.vue'
import type { BroadcastCategory, BroadcastNode, BroadcastReplay, BroadcastSeason } from '../api/league-broadcasts.js'

const season: BroadcastSeason = { id: 1, server: 'CN', year: 2026, name: 'Summer', startDate: null, createdAt: '2026-10-16T12:00:00Z', version: 4, rootCount: 1, replayCount: 0 }
const category: BroadcastCategory = { id: 2, seasonId: 1, type: 'POINTS' }
const node: BroadcastNode = { id: 3, categoryId: 2, roundNumber: 1, format: null, replays: [] }
const existing: BroadcastReplay = { id: 5, nodeId: 3, title: 'Existing', url: 'https://example.org/watch', matchDate: '2026-10-16', dayNumber: 7,
  groupLabel: 'Group A', groupNumber: null, bracket: null, teams: ['Followed', 'Other'], perspective: 'POV', coverId: '493199ec-c421-456b-a865-dcd69ef4c62a' }
let wrappers: ReturnType<typeof mount>[] = []
function dialog(type: BroadcastCategory['type'] = 'POINTS', format: BroadcastNode['format'] = null, replay: BroadcastReplay | null = null, uploads = true) {
  const wrapper = mount(LeagueBroadcastReplayDialog, { props: { open: true, season, category: { ...category, type }, node: { ...node, format }, replay, busy: false, coverUploadAvailable: uploads },
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
  if (wrapper.find('[data-testid=broadcast-group-label]').exists()) await wrapper.get('[data-testid=broadcast-group-label]').setValue('Group A')
}
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:cover-preview')
    static revokeObjectURL = vi.fn()
  })
})
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers = []; vi.unstubAllGlobals() })

describe('broadcast replay form inheritance and fields', () => {
  it.each([
    ['POINTS', null, true, false], ['QUARTER_FINALS', 'ROUND_ROBIN', false, false],
    ['QUARTER_FINALS', 'KNOCKOUT', false, true], ['SEMI_FINALS', null, false, true],
  ] as const)('selects only fields applicable to %s / %s', async (type, format, points, grouped) => {
    const wrapper = dialog(type, format)
    expect(wrapper.find('[data-testid=broadcast-group-label]').exists()).toBe(points)
    expect(wrapper.find('[data-testid=broadcast-group-number]').exists()).toBe(grouped)
    expect(wrapper.find('[data-testid=broadcast-bracket]').exists()).toBe(grouped)
    expect(wrapper.find('[data-testid=broadcast-node-round]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=broadcast-node-format]').exists()).toBe(false)
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    const value = wrapper.emitted('save')![0][0] as any
    expect(value).toMatchObject({ expectedVersion: 4, dayNumber: 7, matchDate: '2026-10-16', teams: ['Followed', 'Other'],
      groupLabel: points ? 'Group A' : null, groupNumber: grouped ? 1 : null, bracket: grouped ? 'DEFAULT' : null, coverAction: 'KEEP' })
    if (points) expect(wrapper.get('[data-testid=broadcast-replay-context]').text()).toContain('第 1 轮积分赛')
    expect(wrapper.get('[data-testid=broadcast-replay-context]').text()).toContain('第 7 天')
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
    expect((wrapper.emitted('save')![0][0] as any).teams).toEqual(['Followed', 'Other', 'Third', 'Fourth'])
  })
  it('preserves or explicitly removes an existing cover without re-uploading it', async () => {
    const wrapper = dialog('POINTS', null, existing, false)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![0].slice(0, 2)).toEqual([expect.objectContaining({ coverAction: 'KEEP' }), null])
    await wrapper.get('[data-testid=broadcast-remove-cover]').trigger('click')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')![1][0]).toMatchObject({ coverAction: 'REMOVE' })
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
