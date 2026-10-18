// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import type { RecommendationDetail } from '../api/creators.js'
import CreatorForm from './CreatorForm.vue'
const state = vi.hoisted(() => ({ auth: null as any }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
let wrappers: ReturnType<typeof mount>[] = [], epoch = 1
function form(detail: RecommendationDetail | null = null, available = true, save = vi.fn(async () => true), loaded = true) {
  const wrapper = mount(CreatorForm, { props: { detail, categories: loaded ? [{ id: 1, name: 'one', type: 'UP' as const }, { id: 2, name: 'two', type: 'UP' as const }] : [], levels: loaded ? [{ id: 1, name: 'expert', type: 'UP' as const }] : [], busy: false, avatarUploadsAvailable: available, save }, global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] } })
  wrappers.push(wrapper); return { wrapper, save }
}
async function fill(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid=creator-name]').setValue('Author'); await wrapper.get('[data-testid=creator-uid]').setValue('456')
  await wrapper.get('[data-testid=creator-category-1]').setValue(true)
}
async function pick(wrapper: ReturnType<typeof mount>, name = 'avatar.png') {
  const file = new File(['image-bytes'], name, { type: 'image/png' }), input = wrapper.get('[data-testid=tournament-image-input]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true }); await input.trigger('change'); await flushPromises(); return file
}
const existing: RecommendationDetail = { type: 'UP', id: 1, version: 2, externalId: '456', name: 'Existing', description: null, categoryIds: [1], levelId: 1, stars: 3, imageUrl: '/api/creators/avatars/11111111-1111-4111-8111-111111111111' }
beforeEach(() => {
  epoch = 1; state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['content-admin'] } }), authEpoch: () => epoch }
  let next = 0
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => `blob:preview-${++next}`); static revokeObjectURL = vi.fn() })
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers = []; vi.unstubAllGlobals() })
describe('creator directory form and local avatar state', () => {
  it('renders a video form without assessment and preserves case in BV and generated link', async () => {
    const save = vi.fn(async () => true)
    const wrapper = mount(CreatorForm, { props: { type: 'VIDEO', categories: [{ id: 2, name: 'Video', type: 'VIDEO' }], levels: [], busy: false, avatarUploadsAvailable: true, save }, global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] } })
    wrappers.push(wrapper)
    expect(wrapper.find('[data-testid=creator-assessed]').exists()).toBe(false)
    await wrapper.get('[data-testid=creator-name]').setValue('Video title')
    await wrapper.get('[data-testid=creator-uid]').setValue('  BV1xx411c7mD  ')
    await wrapper.get('[data-testid=creator-category-2]').setValue(true)
    expect(wrapper.get('[data-testid=creator-homepage]').attributes('href')).toBe('https://www.bilibili.com/video/BV1xx411c7mD')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: 'VIDEO', externalId: 'BV1xx411c7mD', levelId: null, stars: 3 }), null)
  })
  it('accepts 100 supplementary-codepoint names and 2000-codepoint descriptions without UTF16 maxlength truncation', async () => {
    const { wrapper, save } = form(); await fill(wrapper)
    expect(wrapper.get('[data-testid=creator-name]').attributes('maxlength')).toBeUndefined()
    expect(wrapper.get('[data-testid=creator-description]').attributes('maxlength')).toBeUndefined()
    await wrapper.get('[data-testid=creator-name]').setValue('😀'.repeat(100))
    await wrapper.get('[data-testid=creator-description]').setValue('😀'.repeat(2000))
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: '😀'.repeat(100), description: '😀'.repeat(2000), expectedVersion: null }), null)
  })
  it.each([['name', 101], ['description', 2001]] as const)('rejects an over-limit Unicode %s through the generated contract', async (field, count) => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get(`[data-testid=creator-${field}]`).setValue('😀'.repeat(count))
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(save).not.toHaveBeenCalled()
  })
  it('defaults to three whole stars and normalizes UID strings without losing precision', async () => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-uid]').setValue('\u00a0\ufeff0009007199254740993\u3000')
    expect(wrapper.get('[data-testid=creator-homepage]').attributes('href')).toBe('https://space.bilibili.com/9007199254740993')
    await wrapper.get('[data-testid=creator-category-2]').setValue(true)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ externalId: '9007199254740993', stars: 3, categoryIds: [1, 2], levelId: null, imageAction: 'KEEP' }), null)
  })
  it.each(['0', '000', '-1', '1e3', '123456789012345678901', 'https://space.bilibili.com/456'])('rejects invalid UID %s while preserving other draft fields', async uid => {
    const { wrapper, save } = form(); await fill(wrapper); await wrapper.get('[data-testid=creator-uid]').setValue(uid)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).not.toHaveBeenCalled(); expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('Author')
  })
  it('clears an assessment when disabled and requires a level when enabled', async () => {
    const { wrapper, save } = form(); await fill(wrapper); await wrapper.get('[data-testid=creator-assessed]').setValue(true)
    await wrapper.get('form').trigger('submit'); expect(save).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=creator-level]').setValue('1'); await wrapper.get('[data-testid=creator-assessed]').setValue(false)
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(save).toHaveBeenCalledWith(expect.objectContaining({ levelId: null }), null)
  })
  it('prunes deleted dictionary selections without losing the draft and allows replacements', async () => {
    const { wrapper, save } = form(); await fill(wrapper); await wrapper.get('[data-testid=creator-assessed]').setValue(true); await wrapper.get('[data-testid=creator-level]').setValue('1')
    await wrapper.setProps({ categories: [{ id: 2, name: 'two', type: 'UP' as const }], levels: [{ id: 2, name: 'new' }] })
    await wrapper.get('[data-testid=creator-category-2]').setValue(true); await wrapper.get('[data-testid=creator-level]').setValue('2')
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Author', categoryIds: [2], levelId: 2 }), null)
  })
  it('keeps existing edit selections while initial metadata is still loading', async () => {
    const { wrapper, save } = form(existing, false, vi.fn(async () => true), false)
    await wrapper.setProps({ categories: [], levels: [] }); await wrapper.setProps({ categories: [{ id: 1, name: 'one', type: 'UP' as const }], levels: [{ id: 1, name: 'expert' }] })
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(save).toHaveBeenCalledWith(expect.objectContaining({ categoryIds: [1], levelId: 1, imageAction: 'KEEP' }), null)
  })
  it('uses only a local preview until Save and sends the file in the same save attempt', async () => {
    const { wrapper, save } = form(); await fill(wrapper); const file = await pick(wrapper)
    expect(save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid=creator-avatar-preview]').attributes('src')).toBe('blob:preview-1')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ imageAction: 'REPLACE' }), file)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1'); expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('retains the same file and local preview after a failed save, then releases them on successful retry', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), { wrapper } = form(null, true, save)
    await fill(wrapper); const file = await pick(wrapper); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); expect(wrapper.emitted('saved')).toBeUndefined()
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ imageAction: 'REPLACE' }), file)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1'); expect(save).toHaveBeenCalledTimes(2)
  })
  it('allows KEEP and REMOVE without configured storage and restores the original avatar after replacing it', async () => {
    const { wrapper, save } = form(existing, false)
    expect((wrapper.get('[data-testid=tournament-image-input]').element as HTMLInputElement).disabled).toBe(true)
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ imageAction: 'KEEP' }), null)
    await wrapper.get('[data-testid=creator-avatar-clear]').trigger('click'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ imageAction: 'REMOVE', expectedVersion: 2 }), null)
    await wrapper.setProps({ avatarUploadsAvailable: true }); await pick(wrapper)
    await wrapper.get('[data-testid=creator-avatar-restore]').trigger('click'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ imageAction: 'KEEP' }), null)
  })
  it('releases previews on replacement, clear and cancellation without uploading or calling a release API', async () => {
    const { wrapper } = form(); await pick(wrapper); await pick(wrapper, 'second.png')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
    await wrapper.get('[data-testid=creator-avatar-clear]').trigger('click'); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2')
    await pick(wrapper); wrapper.unmount(); wrappers = []; expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-3'); expect(fetch).not.toHaveBeenCalled()
  })
  it('does not release a new actor preview, reset their draft or emit an old acknowledged save', async () => {
    let acknowledge!: (value: boolean) => void
    const save = vi.fn(() => new Promise<boolean>(resolve => { acknowledge = resolve })), { wrapper } = form(null, true, save)
    await fill(wrapper); await pick(wrapper); await wrapper.get('form').trigger('submit')
    epoch++; state.auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['content-admin'] } }; await flushPromises()
    await fill(wrapper); await wrapper.get('[data-testid=creator-name]').setValue('New actor'); await pick(wrapper)
    acknowledge(true); await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined(); expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('New actor')
    expect(wrapper.get('[data-testid=creator-avatar-preview]').attributes('src')).toBe('blob:preview-2'); expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:preview-2')
  })
})
