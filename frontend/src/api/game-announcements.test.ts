// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
const state = vi.hoisted(() => ({ auth: null as any, fetch: vi.fn(), online: true, epoch: 0 }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<object>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<object>(), apiFetch: state.fetch }))
import { createNewsArchives, getManagedNewsImage, getNewsArticle, newsImageUrl, validateNews } from './game-announcements.js'
import { newsAdminAllowed } from '../composables/useAuth.js'

const article = { sourceKey: 'update', title: 'Update', sourceUrl: 'https://asia.wotblitz.com/en/news/updates/update/', language: 'en', publishedAtRaw: '2026-10-13T14:15:00', coverImageId: null, revision: 'hash', blocks: [{ id: 'b1', html: '<p>Original</p>' }], sync: null }
const payload = { idempotencyKey: '93c607c9-a410-4789-bd49-679496c4bc87', archives: [{ version: '11.21', title: 'Update', categoryIds: [1], articles: [{ sourceKey: 'update', revision: 'hash', blockIds: ['b1'] }] }] }
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  vi.clearAllMocks(); state.online = true; state.epoch = 0
  state.auth = { authenticated: ref(true), tokenParsed: ref({ sub: 'one', realm_access: { roles: ['news-admin'] } }), authEpoch: () => state.epoch,
    ensureToken: vi.fn(async () => true), token: () => 'token' }
  state.fetch.mockResolvedValue(response({ archiveIds: [7], deletedIds: [] }))
})
afterEach(() => vi.unstubAllEnvs())
describe('news transport authorization and contract', () => {
  it('allows anonymous source reads without token refresh and requires nullable fields', async () => {
    state.auth.authenticated.value = false; state.fetch.mockResolvedValue(response(article))
    expect(await getNewsArticle('update')).toEqual(article)
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
    expect(state.fetch.mock.calls[0][1].headers).toEqual({})
    const { sync, ...missing } = article
    expect(() => validateNews('NewsArticle', missing)).toThrow('INVALID_RESPONSE')
    expect(() => validateNews('NewsCreateRequest', { ...payload, archives: [{ ...payload.archives[0], html: '<p>untrusted</p>' }] })).toThrow('INVALID_RESPONSE')
  })
  it.each(['news-admin', 'tournament-admin'])('allows the real %s role to archive', async role => {
    state.auth.tokenParsed.value.realm_access.roles = [role]
    await createNewsArchives(payload)
    expect(state.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token')
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual(payload)
  })
  it.each([{ roles: [] }, { roles: ['wotbtools-admin'] }, { roles: ['HoF-admin'] }])('does not substitute unrelated claims or the dev shortcut: $roles', ({ roles }) => {
    state.auth.tokenParsed.value.realm_access.roles = roles
    expect(newsAdminAllowed(state.auth)).toBe(false)
  })
  it('rejects stale claims during refresh and an old-account result', async () => {
    state.auth.ensureToken.mockImplementationOnce(async () => { state.auth.tokenParsed.value.realm_access.roles = []; return true })
    await expect(createNewsArchives(payload)).rejects.toMatchObject({ status: 403 })
    expect(state.fetch).not.toHaveBeenCalled()
    state.auth.tokenParsed.value.realm_access.roles = ['news-admin']
    state.fetch.mockImplementationOnce(async () => { state.epoch++; return response({ archiveIds: [7], deletedIds: [] }) })
    await expect(createNewsArchives(payload)).rejects.toThrow('REQUEST_ABORTED')
  })
  it('does not send requests when offline or token refresh fails', async () => {
    state.online = false
    await expect(getNewsArticle('update')).rejects.toThrow('NETWORK_ERROR')
    state.online = true; state.auth.ensureToken.mockResolvedValue(false)
    await expect(createNewsArchives(payload)).rejects.toMatchObject({ status: 401 })
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it('only maps registered image paths to the Android production origin', () => {
    vi.stubEnv('MODE', 'android')
    expect(newsImageUrl('/api/news/images/uuid-123')).toBe('https://wotbtools.com/api/news/images/uuid-123')
    expect(newsImageUrl('https://official.example/image.jpg')).toBe('')
    expect(newsImageUrl('/api/news/images/../../admin')).toBe('')
    expect(newsImageUrl('/api/news/source-images/id?url=https://example.com')).toBe('')
  })
  it('loads managed image bytes with authentication and rejects non-image payloads', async () => {
    state.fetch.mockResolvedValueOnce(new Response('png', { headers: { 'Content-Type': 'image/png' } }))
    expect((await getManagedNewsImage('uuid')).type).toBe('image/png')
    expect(state.fetch.mock.calls[0][0]).toBe('/api/admin/news/images/uuid')
    state.fetch.mockResolvedValueOnce(new Response('<html>not image</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(getManagedNewsImage('uuid')).rejects.toThrow('INVALID_RESPONSE')
  })
})
