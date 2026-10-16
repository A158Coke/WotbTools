// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { removeUnusedCreatorAvatar, uploadCreatorAvatar } from '../api/creators.js'
import CreatorForm from './CreatorForm.vue'
import type { CreatorDetail } from '../api/creators.js'
import { useCreatorManagement } from '../composables/useCreatorManagement.js'

const state = vi.hoisted(() => ({ auth: null as any }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../api/creators.js', async original => ({ ...await original<typeof import('../api/creators.js')>(), uploadCreatorAvatar: vi.fn(), removeUnusedCreatorAvatar: vi.fn(async () => {}) }))
let wrappers: ReturnType<typeof mount>[] = [], epoch = 1
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
function avatar(index: number) { return { id: ids[index], url: `/api/creators/avatars/${ids[index]}` } }
function form(detail: CreatorDetail | null = null, available = true, save = vi.fn(async () => true), dictionariesLoaded = true) {
  const wrapper = mount(CreatorForm, { props: { detail, categories: dictionariesLoaded ? [{ id: 1, name: 'one' }, { id: 2, name: 'two' }] : [], levels: dictionariesLoaded ? [{ id: 1, name: 'expert' }] : [], busy: false, avatarUploadsAvailable: available, save },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] } })
  wrappers.push(wrapper)
  return { wrapper, save }
}
async function fill(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid=creator-name]').setValue('Author')
  await wrapper.get('[data-testid=creator-homepage]').setValue('https://space.bilibili.com/123')
  await wrapper.get('[data-testid=creator-category-1]').setValue(true)
}
async function pick(wrapper: ReturnType<typeof mount>, name = 'avatar.png') {
  const file = new File(['image-bytes'], name, { type: 'image/png' })
  const input = wrapper.get('[data-testid=tournament-image-input]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change'); await flushPromises()
  return file
}
beforeEach(() => {
  vi.clearAllMocks(); epoch = 1
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => epoch }
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:avatar-preview'); static revokeObjectURL = vi.fn() })
})
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers = []; vi.unstubAllGlobals() })

describe('shared creator form and avatar reservation ownership', () => {
  it('defaults to three stars, supports multiple categories and clears a disabled assessment', async () => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-category-2]').setValue(true)
    await wrapper.get('[data-testid=creator-assessed]').setValue(true)
    await wrapper.get('[data-testid=creator-level]').setValue('1')
    await wrapper.get('[data-testid=creator-assessed]').setValue(false)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ baseStars: 3, categoryIds: [1, 2], levelId: null }))
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('rejects unsafe profiles and missing categories without losing the draft', async () => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-homepage]').setValue('https://space.bilibili.com.evil.test/123')
    await wrapper.get('form').trigger('submit')
    expect(save).not.toHaveBeenCalled()
    expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('Author')
    await wrapper.get('[data-testid=creator-homepage]').setValue('https://space.bilibili.com/0')
    await wrapper.get('form').trigger('submit'); expect(save).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=creator-homepage]').setValue('https://space.bilibili.com/123')
    await wrapper.get('[data-testid=creator-category-1]').setValue(false)
    await wrapper.get('form').trigger('submit'); expect(save).not.toHaveBeenCalled()
  })
  it.each([
    'https://space.bilibili.com/456/?spm_id_from=tracker',
    'https://space.bilibili.com/456?spm_id_from=tracker&source=profile',
  ])('accepts a copied profile query and leaves canonicalization to the server: %s', async homepageUrl => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-homepage]').setValue(`  ${homepageUrl}  `)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ homepageUrl }))
  })
  it.each([
    'https://space.bilibili.com/456/?spm_id_from=tracker#fragment',
    'https://space.bilibili.com.evil.test/456/?spm_id_from=tracker',
    'https://attacker@space.bilibili.com/456/?spm_id_from=tracker',
    'https://space.bilibili.com:443/456/?spm_id_from=tracker',
    'https://space.bilibili.com/456/?spm_id_from=bad value',
  ])('rejects unsafe query/profile syntax: %s', async homepageUrl => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-homepage]').setValue(homepageUrl)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).not.toHaveBeenCalled()
  })
  it('removes a deleted selected category and permits another selection without discarding the draft', async () => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-description]').setValue('Keep this description')
    await wrapper.setProps({ categories: [{ id: 2, name: 'two' }] })
    await wrapper.get('[data-testid=creator-category-2]').setValue(true)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Author', description: 'Keep this description', categoryIds: [2] }))
  })
  it('clears a removed draft skill level and allows choosing its replacement', async () => {
    const { wrapper, save } = form(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-assessed]').setValue(true)
    await wrapper.get('[data-testid=creator-level]').setValue('1')
    await wrapper.setProps({ levels: [{ id: 2, name: 'new level' }] })
    await wrapper.get('form').trigger('submit'); expect(save).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=creator-level]').setValue('2')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Author', levelId: 2 }))
  })
  it('preserves existing edit selections while their dictionaries have not loaded', async () => {
    const detail: CreatorDetail = { id: 1, name: 'Existing', homepageUrl: 'https://space.bilibili.com/1', description: 'Keep existing', categoryIds: [1], levelId: 1, baseStars: 3, avatarId: null, avatarUrl: null }
    const save = vi.fn(async () => true), { wrapper } = form(detail, false, save, false)
    await wrapper.setProps({ categories: [], levels: [] })
    await wrapper.setProps({ categories: [{ id: 1, name: 'one' }], levels: [{ id: 1, name: 'expert' }] })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Existing', description: 'Keep existing', categoryIds: [1], levelId: 1 }))
  })
  it('keeps the existing avatar without upload when storage is unavailable and permits explicit clearing', async () => {
    const detail: CreatorDetail = { id: 1, name: 'Existing', homepageUrl: 'https://space.bilibili.com/1', description: null, categoryIds: [1], levelId: null, baseStars: 3, avatarId: ids[0], avatarUrl: avatar(0).url }
    const { wrapper, save } = form(detail, false)
    expect(wrapper.get('[data-testid=tournament-image-input]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid=creator-avatar-preview]').attributes('src')).toBe(avatar(0).url)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ avatarId: ids[0] }))
    await wrapper.get('[data-testid=creator-avatar-clear]').trigger('click')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ avatarId: null }))
    expect(uploadCreatorAvatar).not.toHaveBeenCalled(); expect(removeUnusedCreatorAvatar).not.toHaveBeenCalled()
  })
  it('releases unused reservations on replacement, clear and cancellation', async () => {
    vi.mocked(uploadCreatorAvatar).mockResolvedValueOnce(avatar(0)).mockResolvedValueOnce(avatar(1))
    const { wrapper } = form()
    await pick(wrapper)
    expect(wrapper.get('[data-testid=creator-avatar-preview]').attributes('src')).toBe('blob:avatar-preview')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    await pick(wrapper, 'replacement.png')
    expect(removeUnusedCreatorAvatar).toHaveBeenCalledWith(ids[0])
    await wrapper.get('[data-testid=creator-avatar-clear]').trigger('click'); await flushPromises()
    expect(removeUnusedCreatorAvatar).toHaveBeenCalledWith(ids[1])
    vi.mocked(uploadCreatorAvatar).mockResolvedValueOnce(avatar(0))
    await pick(wrapper); wrapper.unmount(); wrappers = []
    expect(removeUnusedCreatorAvatar).toHaveBeenCalledTimes(3)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview')
  })
  it('cleans up a late upload after cancellation instead of attaching it', async () => {
    let resolve!: (value: ReturnType<typeof avatar>) => void
    vi.mocked(uploadCreatorAvatar).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const { wrapper } = form(); await pick(wrapper)
    await wrapper.get('[data-testid=creator-avatar-clear]').trigger('click')
    resolve(avatar(0)); await flushPromises()
    expect(removeUnusedCreatorAvatar).toHaveBeenCalledWith(ids[0])
    expect(wrapper.find('[data-testid=creator-avatar-preview]').exists()).toBe(false)
  })
  it('preserves the reservation on save failure and transfers ownership after a successful retry', async () => {
    vi.mocked(uploadCreatorAvatar).mockResolvedValueOnce(avatar(0))
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { wrapper } = form(null, true, save); await fill(wrapper); await pick(wrapper)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined(); expect(removeUnusedCreatorAvatar).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid=creator-avatar-preview]').attributes('src')).toBe('blob:avatar-preview')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ avatarId: ids[0] }))
    wrapper.unmount(); wrappers = []
    expect(removeUnusedCreatorAvatar).not.toHaveBeenCalled()
  })
  it('does not accept a late avatar or retain private draft fields after the account changes', async () => {
    let resolve!: (value: ReturnType<typeof avatar>) => void
    vi.mocked(uploadCreatorAvatar).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const { wrapper } = form(); await fill(wrapper); await pick(wrapper)
    epoch++; state.auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['tournament-admin'] } }
    await flushPromises(); resolve(avatar(0)); await flushPromises()
    expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('')
    expect(removeUnusedCreatorAvatar).toHaveBeenCalledWith(ids[0])
    expect(wrapper.find('[data-testid=creator-avatar-preview]').exists()).toBe(false)
  })
  it('does not emit a previous account\'s save or clear a newer submission after confirmed attachment', async () => {
    vi.mocked(uploadCreatorAvatar).mockResolvedValueOnce(avatar(0))
    let acknowledgeOld!: (value: boolean) => void, finishNew!: (value: boolean) => void
    const save = vi.fn().mockReturnValueOnce(new Promise<boolean>(done => { acknowledgeOld = done }))
      .mockReturnValueOnce(new Promise<boolean>(done => { finishNew = done }))
    const { wrapper } = form(null, true, save); await fill(wrapper); await pick(wrapper)
    await wrapper.get('form').trigger('submit'); expect(save).toHaveBeenCalledTimes(1)
    epoch++; state.auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['tournament-admin'] } }
    await flushPromises(); await fill(wrapper)
    await wrapper.get('[data-testid=creator-name]').setValue('New account draft')
    await wrapper.get('form').trigger('submit'); expect(save).toHaveBeenCalledTimes(2)
    acknowledgeOld(true); await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined(); expect(removeUnusedCreatorAvatar).not.toHaveBeenCalled()
    expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('New account draft')
    expect((wrapper.get('[data-testid=creator-save]').element as HTMLButtonElement).disabled).toBe(true)
    finishNew(false); await flushPromises()
    expect((wrapper.get('[data-testid=creator-save]').element as HTMLButtonElement).disabled).toBe(false)
  })
  it('does not clean up an attached reservation or emit saved when its form unmounts during save', async () => {
    vi.mocked(uploadCreatorAvatar).mockResolvedValueOnce(avatar(0))
    let acknowledge!: (value: boolean) => void
    const save = vi.fn(() => new Promise<boolean>(done => { acknowledge = done }))
    const { wrapper } = form(null, true, save); await fill(wrapper); await pick(wrapper)
    await wrapper.get('form').trigger('submit'); wrapper.unmount(); wrappers = []
    acknowledge(true); await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined(); expect(removeUnusedCreatorAvatar).not.toHaveBeenCalled()
  })
  it('resets an acknowledged create before a slow catalog refresh, preventing a duplicate retry and avatar cleanup', async () => {
    vi.mocked(uploadCreatorAvatar).mockResolvedValueOnce(avatar(0))
    let finishRefresh!: () => void
    const onChanged = vi.fn(() => new Promise<void>(done => { finishRefresh = done }))
    const online = ref(true), transport = {
      listCreatorAdminCategories: vi.fn(async () => [{ id: 1, name: 'category' }]), listCreatorLevels: vi.fn(async () => []),
      getCreatorSettings: vi.fn(async () => ({ favoriteThreshold: 200, avatarUploadsAvailable: true })),
      saveCreator: vi.fn(async () => ({ id: 1 })),
    }
    const harness = defineComponent({ setup() {
      const owner = useCreatorManagement({ api: transport, auth: state.auth, onChanged, network: () => ({ available: online.value }) } as any)
      return () => h(CreatorForm, { key: owner.draftEpoch.value, categories: owner.categories.value, levels: owner.levels.value,
        busy: owner.busy.value || !owner.network.value.available, avatarUploadsAvailable: true,
        save: value => owner.save(value), onSaved: () => owner.finishSave() })
    } })
    const wrapper = mount(harness, { global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] } }); wrappers.push(wrapper)
    await flushPromises(); await fill(wrapper); await pick(wrapper)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(transport.saveCreator).toHaveBeenCalledTimes(1); expect(onChanged).toHaveBeenCalledTimes(1)
    expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('')
    expect(removeUnusedCreatorAvatar).not.toHaveBeenCalled()
    online.value = false; await flushPromises(); finishRefresh(); await flushPromises()
    online.value = true; await flushPromises()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(transport.saveCreator).toHaveBeenCalledTimes(1); expect(removeUnusedCreatorAvatar).not.toHaveBeenCalled()
  })
})
