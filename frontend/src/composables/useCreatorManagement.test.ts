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
