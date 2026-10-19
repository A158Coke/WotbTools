// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import videoCard from '../../../contracts/http/fixtures/recommendation-card.json'
import videoDetail from '../../../contracts/http/fixtures/recommendation-detail.json'
import requestFixture from '../../../contracts/http/fixtures/recommendation-save-request.json'
import { recommendationImageUrl, getCreatorAvailability, getRecommendationDetail, getRecommendationMetadata, listRecommendations, removeRecommendation, saveRecommendation, validateCreator, addCreatorLevel, removeCreatorLevel } from './creators.js'
import { apiFetch } from '../utils/http.js'
import type { RecommendationSaveRequest } from './creators.js'
const state = vi.hoisted(() => ({ auth: null as any, online: true }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<typeof import('../utils/http.js')>(), apiFetch: vi.fn() }))
let epoch = 1
const card = { ...videoCard, type: 'UP', externalId: '123', targetUrl: 'https://space.bilibili.com/123', categories: videoCard.categories.map(category => ({ ...category, type: 'UP' })) }
const detail = { ...videoDetail, type: 'UP', externalId: '123' }
const payload = (): RecommendationSaveRequest => ({ ...requestFixture, type: 'UP', externalId: '123', imageAction: 'KEEP' })
beforeEach(() => {
  vi.clearAllMocks(); state.online = true; epoch = 1
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['content-admin'] } }), authEpoch: () => epoch, ensureToken: vi.fn(async () => true), token: () => 'valid-token' }
})
afterEach(() => vi.unstubAllEnvs())
describe('creator directory transport', () => {
  it('accepts the ECMAScript UID edge whitespace set without accepting internal spaces or zero UIDs', () => {
    const whitespace = [9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196,
      8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279]
    for (const codePoint of whitespace) {
      const padding = String.fromCodePoint(codePoint), externalId = `${padding}000123${padding}`
      expect(validateCreator('RecommendationSaveRequest', { ...payload(), externalId }).externalId).toBe(externalId)
      expect(externalId.trim()).toBe('000123')
      for (const invalid of [`${padding}000${padding}`, `12${padding}3`]) {
        expect(() => validateCreator('RecommendationSaveRequest', { ...payload(), externalId: invalid })).toThrow('INVALID_RESPONSE')
      }
    }
    for (const codePoint of [0, 8, 14, 28, 31, 133, 6158, 8191, 8203, 8234, 8288, 8289, 12289]) {
      const padding = String.fromCodePoint(codePoint)
      expect(() => validateCreator('RecommendationSaveRequest', { ...payload(), externalId: `${padding}123${padding}` })).toThrow('INVALID_RESPONSE')
    }
  })
  it('probes additive availability without authentication or the creator gate and preserves transport failures', async () => {
    state.online = false
    const controller = new AbortController()
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', tanks: 10 })))
    expect(await getCreatorAvailability(controller.signal)).toEqual({ supported: false })
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', tanks: 10, capabilities: ['creators-v1'], future: true })))
    expect(await getCreatorAvailability(controller.signal)).toEqual({ supported: false })
    expect(apiFetch).toHaveBeenLastCalledWith('/api/health', { signal: controller.signal, cache: 'no-store' })
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', tanks: 10, capabilities: ['creators-v1', 'creators-content-visibility-v1'] })))
    expect(await getCreatorAvailability()).toEqual({ supported: false })
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', tanks: 10, capabilities: ['creators-v1', 'creators-content-visibility-v1', 'recommendations-v1'] })))
    expect(await getCreatorAvailability()).toEqual({ supported: true })
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(getCreatorAvailability()).rejects.toMatchObject({ status: 503 })
  })
  it('accepts only the directory shape, canonical UID and even manual score', () => {
    expect(validateCreator('RecommendationCard', card)).toEqual(card)
    for (const invalid of [{ ...card, score: 7 }, { ...card, externalId: '001' }, { ...card, favoriteCount: 1 }, { ...card, subject: 'private' }]) expect(() => validateCreator('RecommendationCard', invalid)).toThrow('INVALID_RESPONSE')
    expect(validateCreator('RecommendationSaveRequest', { ...payload(), externalId: ' 000456 ' }).externalId).toBe(' 000456 ')
    for (const invalid of [{ ...payload(), avatarId: 'external' }, { ...payload(), stars: 3.5 }, { ...payload(), externalId: '000' }]) expect(() => validateCreator('RecommendationSaveRequest', invalid)).toThrow('INVALID_RESPONSE')
  })
  it('reads the public directory anonymously without token refresh', async () => {
    state.auth.authenticated.value = false
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify([card])))
    expect(await listRecommendations('UP', 4)).toEqual([card]); expect(state.auth.ensureToken).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledWith('/api/recommendations?type=UP&categoryId=4', expect.objectContaining({ headers: {} }))
  })
  it('requires a real ready content administrator and a refreshed token', async () => {
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']
    await expect(getRecommendationMetadata('UP')).rejects.toThrow('AUTH_FORBIDDEN')
    state.auth.tokenParsed.value.realm_access.roles = ['content-admin']; state.auth.authInitState.value = 'initializing'
    await expect(getRecommendationDetail(1, 'UP')).rejects.toThrow('AUTH_FORBIDDEN')
    state.auth.authInitState.value = 'authenticated'; state.auth.ensureToken.mockResolvedValueOnce(false)
    await expect(getRecommendationMetadata('UP')).rejects.toThrow('AUTH_UNAUTHENTICATED'); expect(apiFetch).not.toHaveBeenCalled()
  })
  it('rechecks identity after response-body parsing', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, json: async () => { epoch++; return detail } } as Response)
    await expect(getRecommendationDetail(1, 'UP')).rejects.toThrow('REQUEST_ABORTED')
  })
  it.each(['KEEP', 'REMOVE', 'REPLACE'] as const)('saves %s in one multipart request with browser-owned boundary', async imageAction => {
    const file = imageAction === 'REPLACE' ? new File(['image'], 'avatar.png', { type: 'image/png' }) : null
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify(detail)))
    await saveRecommendation(1, { ...payload(), expectedVersion: 0, imageAction }, file)
    const [url, options] = vi.mocked(apiFetch).mock.calls[0]
    expect(url).toBe('/api/admin/recommendations/1'); expect(options?.method).toBe('PUT')
    expect((options?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    const form = options?.body as FormData
    expect((form.get('payload') as Blob).type).toBe('application/json')
    expect(JSON.parse(await (form.get('payload') as Blob).text())).toEqual({ ...payload(), expectedVersion: 0, imageAction })
    expect(form.has('image')).toBe(imageAction === 'REPLACE'); expect(apiFetch).toHaveBeenCalledTimes(1)
  })
  it('rejects action/file mismatch before a request', () => {
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    expect(() => saveRecommendation(null, { ...payload(), imageAction: 'REPLACE' }, null)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => saveRecommendation(null, payload(), file)).toThrow('CREATOR_INVALID_REQUEST'); expect(apiFetch).not.toHaveBeenCalled()
  })
  it('requires null creation versions, a loaded update version and a list version for deletion', async () => {
    expect(() => saveRecommendation(null, { ...payload(), expectedVersion: 0 }, null)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => saveRecommendation(1, payload(), null)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => removeRecommendation(1, 'UP', -1)).toThrow('CREATOR_INVALID_REQUEST')
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await removeRecommendation(1, 'UP', 3)
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/1?type=UP&expectedVersion=3', expect.objectContaining({ method: 'DELETE' }))
  })
  it('validates UP level names using codepoints at the unified management boundary', async () => {
    const name = '😀'.repeat(100)
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, name })))
    expect((await addCreatorLevel(name)).name).toBe(name)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(() => addCreatorLevel(name + '😀')).toThrow('CREATOR_INVALID_REQUEST')
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/levels', expect.objectContaining({ method: 'POST' }))
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await removeCreatorLevel(1)
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/levels/1', expect.objectContaining({ method: 'DELETE' }))
  })
  it('uses the shared offline gate and Android image origin', async () => {
    state.online = false; await expect(listRecommendations('UP', null)).rejects.toThrow('NETWORK_ERROR'); expect(apiFetch).not.toHaveBeenCalled()
    vi.stubEnv('MODE', 'android'); expect(recommendationImageUrl('/api/creators/avatars/id')).toBe('https://wotbtools.com/api/creators/avatars/id')
  })
})
