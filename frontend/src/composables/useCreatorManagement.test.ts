// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import detail from '../../../contracts/http/fixtures/creator-detail.json'
import request from '../../../contracts/http/fixtures/creator-save-request.json'
import type { CreatorDetail, CreatorMetadata, CreatorSaveRequest } from '../api/creators.js'
import { useCreatorManagement } from './useCreatorManagement.js'
import { ApiError } from '../utils/http.js'
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
const payload = (): CreatorSaveRequest => ({ ...request, avatarAction: 'KEEP' })
function fixture(withOnChanged = true) {
  let epoch = 1
  const online = ref(true), metadata: CreatorMetadata = { categories: [{ id: 1, name: 'category' }], levels: [{ id: 1, name: 'level' }], avatarUploadsAvailable: true }
  const auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => epoch }
  const transport = { getCreatorMetadata: vi.fn(async (): Promise<CreatorMetadata> => structuredClone(metadata)), getCreatorDetail: vi.fn(async (): Promise<CreatorDetail> => detail), saveCreator: vi.fn(async () => detail), addCreatorCategory: vi.fn(async () => ({ id: 2, name: 'new' })), removeCreatorCategory: vi.fn(async () => {}) }
  const onChanged = vi.fn(async () => {}), scope = effectScope()
  const availability = { refreshPublicCategories: vi.fn(async () => {}) }
  const owner = scope.run(() => useCreatorManagement({ api: transport, auth, availability, onChanged: withOnChanged ? onChanged : undefined, network: () => ({ available: online.value }) } as any))!
  return { owner, transport, auth, onChanged, scope, online, metadata, availability, changeIdentity: () => { epoch++; auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['tournament-admin'] } } } }
}
describe('creator directory management ownership', () => {
  it('refreshes the global public snapshot from configuration without a page callback', async () => {
    const f = fixture(false); await flushPromises()
    expect(await f.owner.save(payload())).toBe(true); await flushPromises()
    expect(f.availability.refreshPublicCategories).toHaveBeenCalledTimes(1)
    expect(f.onChanged).not.toHaveBeenCalled(); f.scope.stop()
  })
  it('keeps a committed mutation successful if the global content refresh rejects', async () => {
    const f = fixture(); await flushPromises()
    f.availability.refreshPublicCategories.mockRejectedValueOnce(new Error('503'))
    expect(await f.owner.addDictionary('categories', 'new')).toBe(true); await flushPromises()
    expect(f.owner.notice.value).toBe('saved'); expect(f.owner.error.value).toBeNull()
    expect(f.onChanged).toHaveBeenCalledTimes(1); f.scope.stop()
  })
  it('drops private metadata and an open editor immediately on role loss', async () => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(1)
    f.auth.tokenParsed.value.realm_access.roles = []; await nextTick()
    expect(f.owner.categories.value).toEqual([]); expect(f.owner.levels.value).toEqual([])
    expect(f.owner.editorOpen.value).toBe(false); expect(f.owner.detail.value).toBeNull(); f.scope.stop()
  })
  it('acknowledges a save without awaiting a slow catalog refresh and finishes after disconnecting', async () => {
    const f = fixture(); await flushPromises(); let done!: () => void
    f.onChanged.mockReturnValueOnce(new Promise<void>(resolve => { done = resolve }))
    const before = f.owner.draftEpoch.value
    expect(await f.owner.save(payload())).toBe(true); expect(f.owner.busy.value).toBe(false)
    f.online.value = false; await nextTick(); f.owner.finishSave(); expect(f.owner.draftEpoch.value).toBe(before + 1)
    done(); await flushPromises(); expect(f.owner.error.value).toBeNull(); expect(f.transport.saveCreator).toHaveBeenCalledTimes(1); f.scope.stop()
  })
  it.each(['sync', 'async'])('keeps an acknowledged save successful when background refresh fails (%s)', async mode => {
    const f = fixture(); await flushPromises()
    f.onChanged.mockImplementationOnce(() => { if (mode === 'sync') throw new Error('refresh'); return Promise.reject(new Error('refresh')) })
    expect(await f.owner.save(payload())).toBe(true); await flushPromises()
    expect(f.owner.notice.value).toBe('saved'); expect(f.owner.error.value).toBeNull(); f.scope.stop()
  })
  it('does not let an old account completion reset or notify the new account', async () => {
    const f = fixture(); await flushPromises(); f.onChanged.mockImplementationOnce(async () => { f.changeIdentity(); await nextTick() })
    expect(await f.owner.save(payload())).toBe(true); await flushPromises()
    const next = f.owner.draftEpoch.value; f.owner.finishSave(); expect(f.owner.draftEpoch.value).toBe(next); expect(f.owner.notice.value).toBe(''); f.scope.stop()
  })
  it('does not finish an older form after another editor takes ownership', async () => {
    const f = fixture(); await flushPromises(); await f.owner.save(payload()); await f.owner.editCreator(1)
    const next = f.owner.draftEpoch.value; f.owner.finishSave(); expect(f.owner.draftEpoch.value).toBe(next); expect(f.owner.editorOpen.value).toBe(true); f.scope.stop()
  })
  it('ignores UI effects from an acknowledged write after its owner unmounts', async () => {
    const f = fixture(); await flushPromises(); let done!: (value: typeof detail) => void
    f.transport.saveCreator.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const saving = f.owner.save(payload()); f.scope.stop(); const before = f.owner.draftEpoch.value
    done(detail); expect(await saving).toBe(true); f.owner.finishSave(); expect(f.owner.draftEpoch.value).toBe(before); expect(f.onChanged).not.toHaveBeenCalled()
  })
  it('preserves failed editor data and sends the selected file only with the save request', async () => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(1)
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    f.transport.saveCreator.mockRejectedValueOnce(new ApiError({ errorCode: 'CREATOR_CONFIG_CONFLICT', status: 409 }))
    expect(await f.owner.save({ ...payload(), expectedVersion: detail.version, avatarAction: 'REPLACE' }, file, true)).toBe(false)
    expect(f.owner.detail.value?.id).toBe(1); expect(f.owner.editorOpen.value).toBe(true)
    expect(f.owner.detail.value?.version).toBe(detail.version); expect(f.onChanged).not.toHaveBeenCalled()
    expect(await f.owner.save({ ...payload(), expectedVersion: detail.version, avatarAction: 'REPLACE' }, file, true)).toBe(true)
    expect(f.transport.saveCreator).toHaveBeenLastCalledWith(1, expect.objectContaining({ avatarAction: 'REPLACE', expectedVersion: detail.version }), file, expect.any(AbortSignal))
    f.owner.finishSave(true); expect(f.owner.editorOpen.value).toBe(false); f.scope.stop()
  })
  it('keeps a rejected in-use category deletion atomic in the view', async () => {
    const f = fixture(); await flushPromises(); f.transport.removeCreatorCategory.mockRejectedValueOnce(new Error('CREATOR_CATEGORY_IN_USE'))
    expect(await f.owner.removeDictionary('categories', 1)).toBe(false); expect(f.owner.categories.value).toEqual(f.metadata.categories); f.scope.stop()
  })
  it('discards delayed dictionary writes and aborts confirmations after switching accounts', async () => {
    const f = fixture(); await flushPromises(); let done!: (value: { id: number; name: string }) => void
    f.transport.addCreatorCategory.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const signal = f.owner.operationSignal(), adding = f.owner.addDictionary('categories', 'new')
    f.changeIdentity(); await nextTick(); await flushPromises(); done({ id: 99, name: 'old' })
    expect(await adding).toBe(false); expect(signal.aborted).toBe(true); expect(f.owner.categories.value.some(value => value.id === 99)).toBe(false); f.scope.stop()
  })
  it('preserves draft identity and editor data while disconnected, then refreshes metadata once', async () => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(1)
    const draft = f.owner.draftEpoch.value, reads = f.transport.getCreatorMetadata.mock.calls.length
    f.online.value = false; await nextTick(); expect(f.owner.detail.value?.id).toBe(1); expect(f.owner.metadataLoaded.value).toBe(true)
    f.online.value = true; await nextTick(); await flushPromises()
    expect(f.transport.getCreatorMetadata).toHaveBeenCalledTimes(reads + 1); expect(f.owner.draftEpoch.value).toBe(draft); f.scope.stop()
  })
  it('refreshes metadata before exposing a detail moved to a category by another administrator', async () => {
    const f = fixture(); await flushPromises(); let done!: (value: CreatorMetadata) => void
    f.transport.getCreatorMetadata.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    f.transport.getCreatorDetail.mockResolvedValueOnce({ ...detail, categoryIds: [3], levelId: 3 })
    const editing = f.owner.editCreator(1); await flushPromises(); expect(f.owner.detail.value).toBeNull()
    done({ categories: [{ id: 3, name: 'new' }], levels: [{ id: 3, name: 'new level' }], avatarUploadsAvailable: false }); await editing
    expect(f.owner.categories.value[0].id).toBe(3); expect(f.owner.detail.value?.levelId).toBe(3); expect(f.owner.avatarUploadsAvailable.value).toBe(false); f.scope.stop()
  })
  it('prevents an earlier metadata refresh from overwriting a newer editor snapshot or leaving loading stuck', async () => {
    const f = fixture(); await flushPromises(); let done!: (value: CreatorMetadata) => void
    f.transport.getCreatorMetadata.mockReturnValueOnce(new Promise(resolve => { done = resolve })); const old = f.owner.refresh()
    await f.owner.editCreator(1); done({ ...f.metadata, avatarUploadsAvailable: false }); await old
    expect(f.owner.avatarUploadsAvailable.value).toBe(true); expect(f.owner.loading.value).toBe(false); f.scope.stop()
  })
  it('allows retry after a metadata error and ignores detail completion after the editor closes', async () => {
    const f = fixture(); await flushPromises(); f.transport.getCreatorMetadata.mockRejectedValueOnce(new Error('NETWORK_ERROR'))
    await f.owner.editCreator(1); expect(f.owner.detail.value).toBeNull(); expect(f.owner.editorError.value).toBeTruthy()
    await f.owner.retryEditor(); expect(f.owner.detail.value?.id).toBe(1)
    let done!: (value: CreatorDetail) => void
    f.transport.getCreatorDetail.mockReturnValueOnce(new Promise(resolve => { done = resolve })); const editing = f.owner.editCreator(1)
    f.owner.closeEditor(); done(detail); await editing
    expect(f.owner.editorLoading.value).toBe(false); expect(f.owner.detail.value).toBeNull(); f.scope.stop()
  })
})
