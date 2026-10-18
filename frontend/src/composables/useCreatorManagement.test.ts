// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import legacyDetail from '../../../contracts/http/fixtures/creator-detail.json'
const detail = { ...legacyDetail, type: 'UP' as const, externalId: legacyDetail.bilibiliUid, imageUrl: legacyDetail.avatarUrl }
import legacyRequest from '../../../contracts/http/fixtures/creator-save-request.json'
const request = { ...legacyRequest, type: 'UP' as const, externalId: legacyRequest.bilibiliUid, imageAction: 'KEEP' as const }
import type { RecommendationDetail, RecommendationMetadata, RecommendationSaveRequest } from '../api/creators.js'
import { useCreatorManagement } from './useCreatorManagement.js'
import { ApiError } from '../utils/http.js'
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
const payload = (): RecommendationSaveRequest => ({ ...request, imageAction: 'KEEP' })
function fixture(withOnChanged = true) {
  let epoch = 1
  const type = ref<'UP' | 'VIDEO'>('UP')
  const online = ref(true), metadata: RecommendationMetadata = { type: 'UP', categories: [{ id: 1, name: 'category', type: 'UP' as const }], levels: [{ id: 1, name: 'level' }], imageUploadsAvailable: true }
  const auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['content-admin'] } }), authEpoch: () => epoch }
  const transport = { getRecommendationMetadata: vi.fn(async (): Promise<RecommendationMetadata> => structuredClone(metadata)), getRecommendationDetail: vi.fn(async (): Promise<RecommendationDetail> => detail), saveRecommendation: vi.fn(async () => detail), addRecommendationCategory: vi.fn(async () => ({ id: 2, name: 'new', type: 'UP' as const })), removeRecommendationCategory: vi.fn(async () => {}) }
  const onChanged = vi.fn(async () => {}), scope = effectScope()
  const availability = { recommendationsSupported: ref(true), typeAvailable: () => true, refreshPublicCategories: vi.fn(async () => {}) }
  const owner = scope.run(() => useCreatorManagement({ type, api: transport, auth, availability, onChanged: withOnChanged ? onChanged : undefined, network: () => ({ available: online.value }) } as any))!
  return { type, owner, transport, auth, onChanged, scope, online, metadata, availability, changeIdentity: () => { epoch++; auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['content-admin'] } } } }
}
describe('creator directory management ownership', () => {
  it('preserves an active UP draft and invalidates reads when the backend gains typed support', async () => {
    const f = fixture(); f.availability.recommendationsSupported.value = false; await flushPromises()
    await f.owner.editCreator(1); const draft = f.owner.draftEpoch.value
    let done!: (value: RecommendationMetadata) => void
    f.transport.getRecommendationMetadata.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const old = f.owner.refresh(); await flushPromises()
    const signal = f.owner.operationSignal()
    f.availability.recommendationsSupported.value = true; await flushPromises()
    expect(signal.aborted).toBe(true); expect(f.owner.editorOpen.value).toBe(true)
    expect(f.owner.detail.value?.id).toBe(1); expect(f.owner.draftEpoch.value).toBe(draft)
    done({ ...f.metadata, categories: [] }); await old
    expect(f.owner.categories.value).toEqual(f.metadata.categories)
    expect(f.transport.getRecommendationMetadata).toHaveBeenLastCalledWith('UP', true, expect.any(AbortSignal)); f.scope.stop()
  })
  it.each([401, 403])('preserves the current editor when a request is denied with %s', async status => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(1)
    const draft = f.owner.draftEpoch.value
    f.transport.saveRecommendation.mockRejectedValueOnce(new ApiError({ errorCode: 'CREATOR_INVALID_REQUEST', status }))
    expect(await f.owner.save(payload(), null, true)).toBe(false)
    expect(f.owner.detail.value?.id).toBe(detail.id); expect(f.owner.editorOpen.value).toBe(true)
    expect(f.owner.draftEpoch.value).toBe(draft); expect(f.owner.editorError.value).toBeTruthy()
    expect(f.onChanged).not.toHaveBeenCalled(); f.scope.stop()
  })
  it('discards metadata, detail and write effects from a previous type', async () => {
    const f = fixture(); await flushPromises()
    let oldDetail!: (value: typeof detail) => void
    f.transport.getRecommendationDetail.mockReturnValueOnce(new Promise(resolve => { oldDetail = resolve }))
    const reading = f.owner.editCreator(1); await flushPromises()
    f.type.value = 'VIDEO'; await nextTick(); await flushPromises()
    oldDetail(detail); await reading
    expect(f.owner.detail.value).toBeNull(); expect(f.owner.editorOpen.value).toBe(false)
    expect(f.transport.getRecommendationMetadata).toHaveBeenLastCalledWith('VIDEO', true, expect.any(AbortSignal))
    let finish!: (value: typeof detail) => void
    f.transport.saveRecommendation.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const writing = f.owner.save({ ...payload(), type: 'VIDEO', externalId: 'BV1xx411c7mD' })
    f.type.value = 'UP'; await nextTick(); const draft = f.owner.draftEpoch.value
    finish(detail); await writing; f.owner.finishSave(); await flushPromises()
    expect(f.owner.draftEpoch.value).toBe(draft); expect(f.owner.notice.value).toBe('')
    expect(f.onChanged).not.toHaveBeenCalled(); f.scope.stop()
  })
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
    done(); await flushPromises(); expect(f.owner.error.value).toBeNull(); expect(f.transport.saveRecommendation).toHaveBeenCalledTimes(1); f.scope.stop()
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
    f.transport.saveRecommendation.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const saving = f.owner.save(payload()); f.scope.stop(); const before = f.owner.draftEpoch.value
    done(detail); expect(await saving).toBe(true); f.owner.finishSave(); expect(f.owner.draftEpoch.value).toBe(before); expect(f.onChanged).not.toHaveBeenCalled()
  })
  it('preserves failed editor data and sends the selected file only with the save request', async () => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(1)
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    f.transport.saveRecommendation.mockRejectedValueOnce(new ApiError({ errorCode: 'CREATOR_CONFIG_CONFLICT', status: 409 }))
    expect(await f.owner.save({ ...payload(), expectedVersion: detail.version, imageAction: 'REPLACE' }, file, true)).toBe(false)
    expect(f.owner.detail.value?.id).toBe(1); expect(f.owner.editorOpen.value).toBe(true)
    expect(f.owner.detail.value?.version).toBe(detail.version); expect(f.onChanged).not.toHaveBeenCalled()
    expect(await f.owner.save({ ...payload(), expectedVersion: detail.version, imageAction: 'REPLACE' }, file, true)).toBe(true)
    expect(f.transport.saveRecommendation).toHaveBeenLastCalledWith(1, expect.objectContaining({ imageAction: 'REPLACE', expectedVersion: detail.version }), file, true, expect.any(AbortSignal))
    f.owner.finishSave(true); expect(f.owner.editorOpen.value).toBe(false); f.scope.stop()
  })
  it('keeps a rejected in-use category deletion atomic in the view', async () => {
    const f = fixture(); await flushPromises(); f.transport.removeRecommendationCategory.mockRejectedValueOnce(new Error('CREATOR_CATEGORY_IN_USE'))
    expect(await f.owner.removeDictionary('categories', 1)).toBe(false); expect(f.owner.categories.value).toEqual(f.metadata.categories); f.scope.stop()
  })
  it('discards delayed dictionary writes and aborts confirmations after switching accounts', async () => {
    const f = fixture(); await flushPromises(); let done!: (value: { id: number; name: string; type: 'UP' }) => void
    f.transport.addRecommendationCategory.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const signal = f.owner.operationSignal(), adding = f.owner.addDictionary('categories', 'new')
    f.changeIdentity(); await nextTick(); await flushPromises(); done({ id: 99, name: 'old', type: 'UP' as const })
    expect(await adding).toBe(false); expect(signal.aborted).toBe(true); expect(f.owner.categories.value.some(value => value.id === 99)).toBe(false); f.scope.stop()
  })
  it('preserves draft identity and editor data while disconnected, then refreshes metadata once', async () => {
    const f = fixture(); await flushPromises(); await f.owner.editCreator(1)
    const draft = f.owner.draftEpoch.value, reads = f.transport.getRecommendationMetadata.mock.calls.length
    f.online.value = false; await nextTick(); expect(f.owner.detail.value?.id).toBe(1); expect(f.owner.metadataLoaded.value).toBe(true)
    f.online.value = true; await nextTick(); await flushPromises()
    expect(f.transport.getRecommendationMetadata).toHaveBeenCalledTimes(reads + 1); expect(f.owner.draftEpoch.value).toBe(draft); f.scope.stop()
  })
  it('refreshes metadata before exposing a detail moved to a category by another administrator', async () => {
    const f = fixture(); await flushPromises(); let done!: (value: RecommendationMetadata) => void
    f.transport.getRecommendationMetadata.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    f.transport.getRecommendationDetail.mockResolvedValueOnce({ ...detail, categoryIds: [3], levelId: 3 })
    const editing = f.owner.editCreator(1); await flushPromises(); expect(f.owner.detail.value).toBeNull()
    done({ type: 'UP', categories: [{ id: 3, name: 'new', type: 'UP' as const }], levels: [{ id: 3, name: 'new level' }], imageUploadsAvailable: false }); await editing
    expect(f.owner.categories.value[0].id).toBe(3); expect(f.owner.detail.value?.levelId).toBe(3); expect(f.owner.avatarUploadsAvailable.value).toBe(false); f.scope.stop()
  })
  it('prevents an earlier metadata refresh from overwriting a newer editor snapshot or leaving loading stuck', async () => {
    const f = fixture(); await flushPromises(); let done!: (value: RecommendationMetadata) => void
    f.transport.getRecommendationMetadata.mockReturnValueOnce(new Promise(resolve => { done = resolve })); const old = f.owner.refresh()
    await f.owner.editCreator(1); done({ ...f.metadata, imageUploadsAvailable: false }); await old
    expect(f.owner.avatarUploadsAvailable.value).toBe(true); expect(f.owner.loading.value).toBe(false); f.scope.stop()
  })
  it('allows retry after a metadata error and ignores detail completion after the editor closes', async () => {
    const f = fixture(); await flushPromises(); f.transport.getRecommendationMetadata.mockRejectedValueOnce(new Error('NETWORK_ERROR'))
    await f.owner.editCreator(1); expect(f.owner.detail.value).toBeNull(); expect(f.owner.editorError.value).toBeTruthy()
    await f.owner.retryEditor(); expect(f.owner.detail.value?.id).toBe(1)
    let done!: (value: RecommendationDetail) => void
    f.transport.getRecommendationDetail.mockReturnValueOnce(new Promise(resolve => { done = resolve })); const editing = f.owner.editCreator(1)
    f.owner.closeEditor(); done(detail); await editing
    expect(f.owner.editorLoading.value).toBe(false); expect(f.owner.detail.value).toBeNull(); f.scope.stop()
  })
})
