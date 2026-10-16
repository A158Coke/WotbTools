// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import detail from '../../../contracts/http/fixtures/creator-detail.json'
import type { CreatorDetail } from '../api/creators.js'
import { useCreatorManagement } from './useCreatorManagement.js'

vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
function fixture() {
  let epoch = 1
  const online = ref(true)
  const auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => epoch }
  const transport = { listCreatorAdminCategories: vi.fn(async () => [{ id: 1, name: 'category' }]), listCreatorLevels: vi.fn(async () => [{ id: 1, name: 'level' }]),
    getCreatorSettings: vi.fn(async () => ({ favoriteThreshold: 200, avatarUploadsAvailable: true })), getCreatorDetail: vi.fn(async (): Promise<CreatorDetail> => detail), saveCreator: vi.fn(async () => detail),
    addCreatorCategory: vi.fn(async () => ({ id: 2, name: 'new' })), removeCreatorCategory: vi.fn(async () => {}), saveCreatorSettings: vi.fn(async () => ({ favoriteThreshold: 100, avatarUploadsAvailable: true })) }
  const onChanged = vi.fn(async () => {}), scope = effectScope()
  const owner = scope.run(() => useCreatorManagement({ api: transport, auth, onChanged, network: () => ({ available: online.value }) } as any))!
  return { owner, auth, transport, scope, onChanged, online, changeIdentity: () => { epoch++; auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['tournament-admin'] } } } }
}
describe('creator management owner', () => {
  it('acknowledges a save without waiting for a catalog refresh and can finish it after disconnecting', async () => {
    const f = fixture(); await flushPromises()
    let finishRefresh!: () => void
    f.onChanged.mockReturnValueOnce(new Promise<void>(done => { finishRefresh = done }))
    const { id: _id, avatarUrl: _url, ...payload } = detail
    const before = f.owner.draftEpoch.value
    expect(await f.owner.save(payload)).toBe(true)
    expect(f.owner.busy.value).toBe(false); expect(f.onChanged).toHaveBeenCalledTimes(1)
    f.online.value = false; await nextTick()
    f.owner.finishSave()
    expect(f.owner.draftEpoch.value).toBe(before + 1)
    finishRefresh(); await flushPromises()
    expect(f.owner.error.value).toBeNull(); expect(f.transport.saveCreator).toHaveBeenCalledTimes(1); f.scope.stop()
  })
  it.each(['sync', 'async'])('does not report an acknowledged save as failed when the background refresh throws (%s)', async mode => {
    const f = fixture(); await flushPromises()
    f.onChanged.mockImplementationOnce(() => {
      if (mode === 'sync') throw new Error('refresh failed')
      return Promise.reject(new Error('refresh failed'))
    })
    const { id: _id, avatarUrl: _url, ...payload } = detail
    expect(await f.owner.save(payload)).toBe(true); await flushPromises()
    expect(f.owner.notice.value).toBe('saved'); expect(f.owner.error.value).toBeNull()
    expect(f.owner.editorError.value).toBeNull(); expect(f.transport.saveCreator).toHaveBeenCalledTimes(1); f.scope.stop()
  })
  it('does not let a previous account\'s acknowledged save notify or reset the new account\'s form', async () => {
    const f = fixture(); await flushPromises()
    f.onChanged.mockImplementationOnce(async () => { f.changeIdentity(); await nextTick() })
    const { id: _id, avatarUrl: _url, ...payload } = detail
    expect(await f.owner.save(payload)).toBe(true); await flushPromises()
    const newAccountDraft = f.owner.draftEpoch.value
    f.owner.finishSave()
    expect(f.owner.draftEpoch.value).toBe(newAccountDraft); expect(f.owner.notice.value).toBe(''); f.scope.stop()
  })
  it('does not consume an acknowledged completion after a different editor has taken ownership', async () => {
    const f = fixture(); await flushPromises()
    const { id: _id, avatarUrl: _url, ...payload } = detail
    expect(await f.owner.save(payload)).toBe(true)
    await f.owner.editCreator(detail.id)
    const currentDraft = f.owner.draftEpoch.value
    f.owner.finishSave()
    expect(f.owner.draftEpoch.value).toBe(currentDraft); expect(f.owner.editorOpen.value).toBe(true); f.scope.stop()
  })
  it('keeps an acknowledged result from an unmounted owner from changing a form or notice', async () => {
    const f = fixture(); await flushPromises()
    let acknowledge!: (value: typeof detail) => void
    f.transport.saveCreator.mockReturnValueOnce(new Promise(done => { acknowledge = done }))
    const { id: _id, avatarUrl: _url, ...payload } = detail
    const saving = f.owner.save(payload)
    f.scope.stop(); const disposedDraft = f.owner.draftEpoch.value
    acknowledge(detail); expect(await saving).toBe(true)
    f.owner.finishSave()
    expect(f.owner.draftEpoch.value).toBe(disposedDraft); expect(f.owner.notice.value).toBe(''); expect(f.onChanged).not.toHaveBeenCalled()
  })
  it('preserves a failed editor and only closes/resets after the form acknowledges attachment', async () => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(detail.id)
    const { id: _id, avatarUrl: _url, ...payload } = detail
    f.transport.saveCreator.mockRejectedValueOnce(new Error('CREATOR_CONFIG_CONFLICT'))
    expect(await f.owner.save(payload, true)).toBe(false)
    expect(f.owner.detail.value?.id).toBe(detail.id); expect(f.owner.editorOpen.value).toBe(true)
    expect(await f.owner.save(payload, true)).toBe(true)
    expect(f.owner.editorOpen.value).toBe(true)
    f.owner.finishSave(true); expect(f.owner.editorOpen.value).toBe(false); f.scope.stop()
  })
  it('keeps failed in-use dictionary deletions atomic in the UI and reads the server threshold', async () => {
    const f = fixture(); await flushPromises()
    f.transport.removeCreatorCategory.mockRejectedValueOnce(new Error('CREATOR_CATEGORY_IN_USE'))
    expect(await f.owner.removeDictionary('categories', 1)).toBe(false)
    expect(f.owner.categories.value).toEqual([{ id: 1, name: 'category' }])
    await f.owner.setThreshold(100); expect(f.owner.settings.value?.favoriteThreshold).toBe(100); f.scope.stop()
  })
  it('discards late dictionary mutations and aborts confirmation/editor ownership on identity change', async () => {
    const f = fixture(); await flushPromises()
    let resolve!: (value: any) => void
    f.transport.addCreatorCategory.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const signal = f.owner.operationSignal(), pending = f.owner.addDictionary('categories', 'new')
    f.changeIdentity(); await nextTick(); await flushPromises()
    resolve({ id: 99, name: 'old account' }); expect(await pending).toBe(false)
    expect(signal.aborted).toBe(true); expect(f.owner.categories.value.some(value => value.id === 99)).toBe(false)
    expect(f.onChanged).not.toHaveBeenCalled(); f.scope.stop()
  })
  it('preserves this account\'s editor and creation draft identity across a temporary disconnect', async () => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(detail.id)
    const draftEpoch = f.owner.draftEpoch.value, signal = f.owner.operationSignal()
    const reads = f.transport.getCreatorSettings.mock.calls.length
    f.online.value = false; await nextTick()
    expect(signal.aborted).toBe(true)
    expect(f.owner.editorOpen.value).toBe(true); expect(f.owner.detail.value?.id).toBe(detail.id)
    expect(f.owner.settings.value?.favoriteThreshold).toBe(200); expect(f.owner.draftEpoch.value).toBe(draftEpoch)
    f.online.value = true; await nextTick(); await flushPromises()
    expect(f.transport.getCreatorSettings).toHaveBeenCalledTimes(reads + 1)
    expect(f.owner.draftEpoch.value).toBe(draftEpoch); f.scope.stop()
  })
  it('refreshes editor dictionaries and settings before exposing a newly categorized detail', async () => {
    const f = fixture(); await flushPromises()
    let resolveCategories!: (value: { id: number; name: string }[]) => void
    f.transport.listCreatorAdminCategories.mockReturnValueOnce(new Promise(done => { resolveCategories = done }))
    f.transport.listCreatorLevels.mockResolvedValueOnce([{ id: 3, name: 'new level' }])
    f.transport.getCreatorSettings.mockResolvedValueOnce({ favoriteThreshold: 50, avatarUploadsAvailable: false })
    f.transport.getCreatorDetail.mockResolvedValueOnce({ ...detail, categoryIds: [3], levelId: 3 })
    const edit = f.owner.editCreator(detail.id); await flushPromises()
    expect(f.owner.detail.value).toBeNull(); expect(f.owner.editorLoading.value).toBe(true)
    resolveCategories([{ id: 3, name: 'new category' }]); await edit
    expect(f.owner.categories.value).toEqual([{ id: 3, name: 'new category' }])
    expect(f.owner.levels.value).toEqual([{ id: 3, name: 'new level' }])
    expect(f.owner.settings.value).toEqual({ favoriteThreshold: 50, avatarUploadsAvailable: false })
    expect(f.owner.detail.value).toMatchObject({ categoryIds: [3], levelId: 3 })
    const { id: _id, avatarUrl: _url, ...payload } = f.owner.detail.value!
    expect(await f.owner.save(payload, true)).toBe(true); f.scope.stop()
  })
  it('does not let an earlier refresh overwrite editor metadata or keep loading stuck', async () => {
    const f = fixture(); await flushPromises()
    let resolveOld!: (value: { favoriteThreshold: number; avatarUploadsAvailable: boolean }) => void
    f.transport.getCreatorSettings.mockReturnValueOnce(new Promise(done => { resolveOld = done }))
    const refresh = f.owner.refresh()
    f.transport.getCreatorSettings.mockResolvedValueOnce({ favoriteThreshold: 75, avatarUploadsAvailable: true })
    await f.owner.editCreator(detail.id)
    expect(f.owner.loading.value).toBe(false); expect(f.owner.editorLoading.value).toBe(false)
    resolveOld({ favoriteThreshold: 900, avatarUploadsAvailable: false }); await refresh
    expect(f.owner.settings.value?.favoriteThreshold).toBe(75); expect(f.owner.loading.value).toBe(false); f.scope.stop()
  })
  it('keeps failed editor loads recoverable and ignores a closed editor\'s late metadata', async () => {
    const f = fixture(); await flushPromises()
    f.transport.listCreatorAdminCategories.mockRejectedValueOnce(new Error('NETWORK_ERROR'))
    await f.owner.editCreator(detail.id)
    expect(f.owner.detail.value).toBeNull(); expect(f.owner.editorError.value).toBeTruthy(); expect(f.owner.editorLoading.value).toBe(false)
    await f.owner.retryEditor()
    expect(f.owner.detail.value?.id).toBe(detail.id); expect(f.owner.editorError.value).toBeNull()
    let resolveLate!: (value: typeof detail) => void
    f.transport.getCreatorDetail.mockReturnValueOnce(new Promise(done => { resolveLate = done }))
    const edit = f.owner.editCreator(detail.id)
    f.owner.closeEditor(); expect(f.owner.editorLoading.value).toBe(false)
    resolveLate(detail); await edit
    expect(f.owner.editorOpen.value).toBe(false); expect(f.owner.detail.value).toBeNull()
    await f.owner.refresh(); expect(f.owner.loading.value).toBe(false); f.scope.stop()
  })
})
