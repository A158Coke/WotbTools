// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import card from '../../../contracts/http/fixtures/creator-card.json'
import detail from '../../../contracts/http/fixtures/creator-detail.json'
import { creatorAvatarUrl, getCreatorDetail, listCreators, saveCreator, setCreatorFavorite, uploadCreatorAvatar, validateCreator } from './creators.js'
import { apiFetch } from '../utils/http.js'

const state = vi.hoisted(() => ({ auth: null as any, online: true }))
vi.mock('../composables/useAuth.js', async original => ({
  ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth,
}))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<typeof import('../utils/http.js')>(), apiFetch: vi.fn() }))

let epoch = 1
beforeEach(() => {
  vi.clearAllMocks(); state.online = true; epoch = 1
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['tournament-admin'] } }),
    authEpoch: () => epoch, ensureToken: vi.fn(async () => true), token: () => 'valid-token' }
})
afterEach(() => vi.unstubAllEnvs())

describe('creator runtime and transport boundary', () => {
  it('accepts canonical cards and rejects out-of-range scores and leaked private history', () => {
    expect(validateCreator('CreatorCard', card)).toEqual(card)
    expect(() => validateCreator('CreatorCard', { ...card, score: 11 })).toThrow('INVALID_RESPONSE')
    expect(() => validateCreator('CreatorCard', { ...card, subject: 'private-user' })).toThrow('INVALID_RESPONSE')
    expect(() => validateCreator('CreatorCard', { ...card, score: '7' })).toThrow('INVALID_RESPONSE')
    expect(() => validateCreator('CreatorCard', { ...card, homepageUrl: 'javascript:alert(1)' })).toThrow('INVALID_RESPONSE')
  })
  it('reads the public list anonymously without refreshing or attaching a token', async () => {
    state.auth.authenticated.value = false
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify([card])))
    expect(await listCreators(4)).toEqual([card])
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledWith('/api/creators?categoryId=4', expect.objectContaining({ headers: {} }))
  })
  it('does not authorize site-only roles or a non-ready session for management', async () => {
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']
    await expect(getCreatorDetail(1)).rejects.toThrow('AUTH_FORBIDDEN')
    state.auth.tokenParsed.value.realm_access.roles = ['tournament-admin']
    state.auth.authInitState.value = 'initializing'
    await expect(getCreatorDetail(1)).rejects.toThrow('AUTH_FORBIDDEN')
    expect(apiFetch).not.toHaveBeenCalled()
  })
  it('requires a refreshed Bearer for ordinary-user favorite writes', async () => {
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-user']
    state.auth.ensureToken.mockResolvedValueOnce(false)
    await expect(setCreatorFavorite(1, true)).rejects.toThrow('AUTH_UNAUTHENTICATED')
    expect(apiFetch).not.toHaveBeenCalled()
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ creator: card, active: true })))
    expect((await setCreatorFavorite(1, true)).active).toBe(true)
    expect(apiFetch).toHaveBeenCalledWith('/api/creators/1/favorite', expect.objectContaining({ method: 'PUT', headers: { Authorization: 'Bearer valid-token' } }))
  })
  it('rechecks identity after response-body parsing, not only after headers arrive', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, json: async () => { epoch++; return detail } } as Response)
    await expect(getCreatorDetail(1)).rejects.toThrow('REQUEST_ABORTED')
  })
  it('serializes only editable fields and keeps avatar multipart content-type browser-owned', async () => {
    const { id: _id, avatarUrl: _url, ...request } = detail
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify(detail)))
    await saveCreator(detail.id, request)
    expect(apiFetch).toHaveBeenLastCalledWith(`/api/admin/creators/${detail.id}`, expect.objectContaining({ method: 'PUT', body: JSON.stringify(request) }))
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', url: '/api/creators/avatars/00000000-0000-0000-0000-000000000001' })))
    await uploadCreatorAvatar(new File(['bytes'], 'avatar.png', { type: 'image/png' }))
    const options = vi.mocked(apiFetch).mock.calls.at(-1)![1]!
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect((options.body as FormData).get('file')).toBeInstanceOf(File)
  })
  it('gates offline requests and resolves avatar reads across the Android origin', async () => {
    state.online = false
    await expect(listCreators()).rejects.toThrow('NETWORK_ERROR')
    expect(apiFetch).not.toHaveBeenCalled()
    vi.stubEnv('MODE', 'android')
    expect(creatorAvatarUrl('/api/creators/avatars/id')).toBe('https://wotbtools.com/api/creators/avatars/id')
    expect(creatorAvatarUrl(null)).toBe('')
  })
})
