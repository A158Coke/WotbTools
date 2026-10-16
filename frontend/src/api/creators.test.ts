// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import card from '../../../contracts/http/fixtures/creator-card.json'
import detail from '../../../contracts/http/fixtures/creator-detail.json'
import requestFixture from '../../../contracts/http/fixtures/creator-save-request.json'
import { creatorAvatarUrl, getCreatorDetail, getCreatorMetadata, listCreators, saveCreator, validateCreator } from './creators.js'
import { apiFetch } from '../utils/http.js'
import type { CreatorSaveRequest } from './creators.js'
const state = vi.hoisted(() => ({ auth: null as any, online: true }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<typeof import('../utils/http.js')>(), apiFetch: vi.fn() }))
let epoch = 1
const payload = (): CreatorSaveRequest => ({ ...requestFixture, avatarAction: 'KEEP' })
beforeEach(() => {
  vi.clearAllMocks(); state.online = true; epoch = 1
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => epoch, ensureToken: vi.fn(async () => true), token: () => 'valid-token' }
})
afterEach(() => vi.unstubAllEnvs())
describe('creator directory transport', () => {
  it('accepts only the directory shape, canonical UID and even manual score', () => {
    expect(validateCreator('CreatorCard', card)).toEqual(card)
    for (const invalid of [{ ...card, score: 7 }, { ...card, bilibiliUid: '001' }, { ...card, favoriteCount: 1 }, { ...card, subject: 'private' }]) expect(() => validateCreator('CreatorCard', invalid)).toThrow('INVALID_RESPONSE')
    expect(validateCreator('CreatorSaveRequest', { ...payload(), bilibiliUid: ' 000456 ' }).bilibiliUid).toBe(' 000456 ')
    for (const invalid of [{ ...payload(), avatarId: 'external' }, { ...payload(), stars: 3.5 }, { ...payload(), bilibiliUid: '000' }]) expect(() => validateCreator('CreatorSaveRequest', invalid)).toThrow('INVALID_RESPONSE')
  })
  it('reads the public directory anonymously without token refresh', async () => {
    state.auth.authenticated.value = false
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify([card])))
    expect(await listCreators(4)).toEqual([card]); expect(state.auth.ensureToken).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledWith('/api/creators?categoryId=4', expect.objectContaining({ headers: {} }))
  })
  it('requires a real ready tournament administrator and a refreshed token', async () => {
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']
    await expect(getCreatorMetadata()).rejects.toThrow('AUTH_FORBIDDEN')
    state.auth.tokenParsed.value.realm_access.roles = ['tournament-admin']; state.auth.authInitState.value = 'initializing'
    await expect(getCreatorDetail(1)).rejects.toThrow('AUTH_FORBIDDEN')
    state.auth.authInitState.value = 'authenticated'; state.auth.ensureToken.mockResolvedValueOnce(false)
    await expect(getCreatorMetadata()).rejects.toThrow('AUTH_UNAUTHENTICATED'); expect(apiFetch).not.toHaveBeenCalled()
  })
  it('rechecks identity after response-body parsing', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, json: async () => { epoch++; return detail } } as Response)
    await expect(getCreatorDetail(1)).rejects.toThrow('REQUEST_ABORTED')
  })
  it.each(['KEEP', 'REMOVE', 'REPLACE'] as const)('saves %s in one multipart request with browser-owned boundary', async avatarAction => {
    const file = avatarAction === 'REPLACE' ? new File(['image'], 'avatar.png', { type: 'image/png' }) : null
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify(detail)))
    await saveCreator(1, { ...payload(), avatarAction }, file)
    const [url, options] = vi.mocked(apiFetch).mock.calls[0]
    expect(url).toBe('/api/admin/creators/1'); expect(options?.method).toBe('PUT')
    expect((options?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    const form = options?.body as FormData
    expect((form.get('payload') as Blob).type).toBe('application/json')
    expect(JSON.parse(await (form.get('payload') as Blob).text())).toEqual({ ...payload(), avatarAction })
    expect(form.has('avatar')).toBe(avatarAction === 'REPLACE'); expect(apiFetch).toHaveBeenCalledTimes(1)
  })
  it('rejects action/file mismatch before a request', () => {
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    expect(() => saveCreator(null, { ...payload(), avatarAction: 'REPLACE' }, null)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => saveCreator(null, payload(), file)).toThrow('CREATOR_INVALID_REQUEST'); expect(apiFetch).not.toHaveBeenCalled()
  })
  it('uses the shared offline gate and Android image origin', async () => {
    state.online = false; await expect(listCreators()).rejects.toThrow('NETWORK_ERROR'); expect(apiFetch).not.toHaveBeenCalled()
    vi.stubEnv('MODE', 'android'); expect(creatorAvatarUrl('/api/creators/avatars/id')).toBe('https://wotbtools.com/api/creators/avatars/id')
  })
})
