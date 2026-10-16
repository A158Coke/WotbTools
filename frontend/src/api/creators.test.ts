// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import card from '../../../contracts/http/fixtures/creator-card.json'
import detail from '../../../contracts/http/fixtures/creator-detail.json'
import requestFixture from '../../../contracts/http/fixtures/creator-save-request.json'
import { creatorAvatarUrl, getCreatorAvailability, getCreatorDetail, getCreatorMetadata, listCreators, removeCreator, saveCreator, validateCreator, addCreatorCategory, addCreatorLevel } from './creators.js'
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
  it('probes additive availability without authentication or the creator gate and preserves transport failures', async () => {
    state.online = false
    const controller = new AbortController()
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', tanks: 10 })))
    expect(await getCreatorAvailability(controller.signal)).toBe(false)
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', tanks: 10, capabilities: ['creators-v1'], future: true })))
    expect(await getCreatorAvailability(controller.signal)).toBe(true)
    expect(apiFetch).toHaveBeenLastCalledWith('/api/health', { signal: controller.signal, cache: 'no-store' })
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(getCreatorAvailability()).rejects.toMatchObject({ status: 503 })
  })
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
    await saveCreator(1, { ...payload(), expectedVersion: 0, avatarAction }, file)
    const [url, options] = vi.mocked(apiFetch).mock.calls[0]
    expect(url).toBe('/api/admin/creators/1'); expect(options?.method).toBe('PUT')
    expect((options?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    const form = options?.body as FormData
    expect((form.get('payload') as Blob).type).toBe('application/json')
    expect(JSON.parse(await (form.get('payload') as Blob).text())).toEqual({ ...payload(), expectedVersion: 0, avatarAction })
    expect(form.has('avatar')).toBe(avatarAction === 'REPLACE'); expect(apiFetch).toHaveBeenCalledTimes(1)
  })
  it('rejects action/file mismatch before a request', () => {
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    expect(() => saveCreator(null, { ...payload(), avatarAction: 'REPLACE' }, null)).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => saveCreator(null, payload(), file)).toThrow('CREATOR_INVALID_REQUEST'); expect(apiFetch).not.toHaveBeenCalled()
  })
  it('requires null creation versions, a loaded update version and a list version for deletion', async () => {
    expect(() => saveCreator(null, { ...payload(), expectedVersion: 0 })).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => saveCreator(1, payload())).toThrow('CREATOR_INVALID_REQUEST')
    expect(() => removeCreator(1, -1)).toThrow('CREATOR_INVALID_REQUEST')
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await removeCreator(1, 3)
    expect(apiFetch).toHaveBeenLastCalledWith('/api/admin/creators/1?expectedVersion=3', expect.objectContaining({ method: 'DELETE' }))
  })
  it.each([addCreatorCategory, addCreatorLevel])('validates dictionary names using codepoints before transport', async add => {
    const name = '😀'.repeat(100)
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, name })))
    expect((await add(name)).name).toBe(name)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(() => add(name + '😀')).toThrow('CREATOR_INVALID_REQUEST')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
  it('uses the shared offline gate and Android image origin', async () => {
    state.online = false; await expect(listCreators()).rejects.toThrow('NETWORK_ERROR'); expect(apiFetch).not.toHaveBeenCalled()
    vi.stubEnv('MODE', 'android'); expect(creatorAvatarUrl('/api/creators/avatars/id')).toBe('https://wotbtools.com/api/creators/avatars/id')
  })
})
