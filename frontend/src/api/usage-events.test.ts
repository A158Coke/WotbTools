import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postUsageEvents, type UsageEvent } from './usage-events.js'

const mocks = vi.hoisted(() => ({ bearer: vi.fn(), fetch: vi.fn() }))
vi.mock('./replay-capabilities.js', () => ({ optionalBearer: mocks.bearer }))
vi.mock('../utils/http.js', () => ({ apiFetch: mocks.fetch }))
const auth = { token: () => 'unused', ensureToken: async () => true }
const activity: UsageEvent = { event: 'active_user', feature: 'home', platform: 'web',
  event_id: '03cbad3d-49ba-4889-af15-fc24dbdb99b5', occurred_at: '2026-10-16T00:00:00Z' }

beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue({ status: 204 }) })
describe('usage HTTP boundary', () => {
  it('requires an available bearer for activity and never downgrades to anonymous activity', async () => {
    mocks.bearer.mockResolvedValue({})
    await postUsageEvents([activity], { auth, isCurrent: () => true })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('drops activity when token refresh outlives the account or foreground owner', async () => {
    mocks.bearer.mockResolvedValue({ Authorization: 'Bearer valid' })
    await postUsageEvents([activity], { auth, isCurrent: () => false })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('sends authenticated activity with bounded request lifetime', async () => {
    mocks.bearer.mockResolvedValue({ Authorization: 'Bearer valid' })
    await postUsageEvents([activity], { auth, isCurrent: () => true })
    const [path, init] = mocks.fetch.mock.calls[0]
    expect(path).toBe('/api/observability/events')
    expect(init.headers.Authorization).toBe('Bearer valid')
    expect(JSON.parse(init.body)).toEqual({ events: [activity] })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
