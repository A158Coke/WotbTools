// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import card from '../../../contracts/http/fixtures/recommendation-card.json'
import detail from '../../../contracts/http/fixtures/recommendation-detail.json'
import metadata from '../../../contracts/http/fixtures/recommendation-metadata.json'
import { addRecommendationCategory, getRecommendationDetail, getRecommendationMetadata,
  listRecommendationCategories, listRecommendations, recommendationInputValid,
  removeRecommendation, removeRecommendationCategory, saveRecommendation, validateCreator,
  type RecommendationSaveRequest } from './creators.js'
import { apiFetch } from '../utils/http.js'
const state = vi.hoisted(() => ({ auth: null as any, online: true }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<typeof import('../utils/http.js')>(), apiFetch: vi.fn() }))
const value = (): RecommendationSaveRequest => ({ type: 'VIDEO', externalId: ' BV1xx411c7mD ', name: 'Example video', description: null, categoryIds: [7], levelId: null, stars: 3, imageAction: 'KEEP', expectedVersion: null })
const respond = (body: unknown) => vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify(body)))
beforeEach(() => {
  vi.clearAllMocks(); state.online = true
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['content-admin'] } }), authEpoch: () => 1, ensureToken: vi.fn(async () => true), token: () => 'token' }
})
describe('typed recommendations boundary', () => {
  it('enforces type-specific identifiers, strength and category response constraints', () => {
    for (const externalId of ['BV1xx411c7mD', 'BV1XX411C7MD', '\uFEFF BV1xx411c7mD\t']) expect(recommendationInputValid({ ...value(), externalId })).toBe(true)
    for (const externalId of ['bv1xx411c7mD', 'BV1xx411c7m', 'BV1xx411c7mDD', 'BV1xx 11c7mD', '123', '\u200bBV1xx411c7mD']) expect(recommendationInputValid({ ...value(), externalId })).toBe(false)
    expect(recommendationInputValid({ ...value(), levelId: 1 })).toBe(false)
    expect(recommendationInputValid({ ...value(), type: 'UP', externalId: ' 000123 ', levelId: 1 })).toBe(true)
    expect(recommendationInputValid({ ...value(), type: 'UP' })).toBe(false)
    expect(recommendationInputValid({ ...value(), type: 'OTHER' })).toBe(false)
    expect(recommendationInputValid({ ...value(), avatarAction: 'KEEP' })).toBe(false)
    expect(validateCreator('RecommendationCard', card)).toEqual(card)
    for (const invalid of [{ ...card, level: { id: 1, name: 'Expert' } }, { ...card, targetUrl: 'https://space.bilibili.com/123' }, { ...card, categories: [{ ...card.categories[0], type: 'UP' }] }]) expect(() => validateCreator('RecommendationCard', invalid)).toThrow('INVALID_RESPONSE')
    expect(() => validateCreator('RecommendationMetadata', { ...metadata, levels: [{ id: 1, name: 'Expert' }] })).toThrow('INVALID_RESPONSE')
  })
  it('reads the two-type public snapshot anonymously and limits lists to their requested type', async () => {
    state.auth.authenticated.value = false
    const categories = [{ id: 1, name: 'UPs', type: 'UP' }, ...card.categories]
    respond(categories); expect(await listRecommendationCategories()).toEqual(categories)
    respond([card]); expect(await listRecommendations('VIDEO', 7)).toEqual([card])
    expect(apiFetch).toHaveBeenLastCalledWith('/api/recommendations?type=VIDEO&categoryId=7', expect.objectContaining({ headers: {} }))
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
    respond([card]); await expect(listRecommendations('UP', null)).rejects.toThrow('INVALID_RESPONSE')
  })
  it('uses typed queries on admin reads, deletes and category writes', async () => {
    respond(metadata); expect(await getRecommendationMetadata('VIDEO')).toEqual(metadata)
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/metadata?type=VIDEO', expect.objectContaining({ headers: { Authorization: 'Bearer token' } }))
    respond(detail); expect(await getRecommendationDetail(3, 'VIDEO')).toEqual(detail)
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/3?type=VIDEO', expect.anything())
    respond(card.categories[0]); await addRecommendationCategory('VIDEO', ' Featured videos ')
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/categories', expect.objectContaining({ body: JSON.stringify({ type: 'VIDEO', name: 'Featured videos' }) }))
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 204 })); await removeRecommendation(3, 'VIDEO', 2)
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/3?type=VIDEO&expectedVersion=2', expect.objectContaining({ method: 'DELETE' }))
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 204 })); await removeRecommendationCategory(7, 'VIDEO')
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/recommendations/categories/7?type=VIDEO', expect.objectContaining({ method: 'DELETE' }))
  })
  it('saves VIDEO in one multipart request preserving BV case and using image instead of avatar', async () => {
    const image = new File(['image'], 'cover.png', { type: 'image/png' }), input = { ...value(), imageAction: 'REPLACE' as const }
    respond(detail); await saveRecommendation(null, input, image)
    const [url, options] = vi.mocked(apiFetch).mock.calls[0], form = options?.body as FormData
    expect(url).toBe('/api/admin/recommendations'); expect(options?.method).toBe('POST')
    expect(form.has('avatar')).toBe(false); expect(form.has('image')).toBe(true)
    expect((options?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect(JSON.parse(await (form.get('payload') as Blob).text())).toEqual(input)
    expect(() => saveRecommendation(null, input, null)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => saveRecommendation(3, value(), null)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => removeRecommendation(3, 'VIDEO', -1)).toThrow('CREATOR_INVALID_REQUEST')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
  it('rejects unknown types before transport', async () => {
    const invalid = 'OTHER' as 'UP'
    await expect(listRecommendations(invalid, null)).rejects.toThrow('CREATOR_INVALID_REQUEST')
    await expect(getRecommendationMetadata(invalid)).rejects.toThrow('CREATOR_INVALID_REQUEST')
    await expect(getRecommendationDetail(1, invalid)).rejects.toThrow('CREATOR_INVALID_REQUEST')
    expect(() => removeRecommendation(1, invalid, 0)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => addRecommendationCategory(invalid, 'category')).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => removeRecommendationCategory(1, invalid)).toThrow('CREATOR_INVALID_REQUEST')
    expect(apiFetch).not.toHaveBeenCalled()
  })
  it('retains role and offline gates for the new endpoints', async () => {
    state.auth.tokenParsed.value.realm_access.roles = []
    await expect(getRecommendationMetadata('VIDEO')).rejects.toThrow('AUTH_FORBIDDEN')
    state.online = false
    await expect(listRecommendations('VIDEO', null)).rejects.toThrow('NETWORK_ERROR')
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
