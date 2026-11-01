import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ALLOWED_VIEWS } from '../app/navigation.js'
import { useSiteFeedback } from './useSiteFeedback.js'

const state = vi.hoisted(() => ({ authenticated: null, login: null, online: true }))
vi.mock('./useAuth.js', () => ({ useAuth: () => ({ authenticated: state.authenticated, login: state.login }) }))
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))

const route = { path: '/', query: { view: 'hof', tab: 'mark3' }, hash: '#top' }
beforeEach(() => {
  state.authenticated = ref(false)
  state.login = vi.fn()
  state.online = true
})

describe('useSiteFeedback', () => {
  it('opens with the current view for a signed-in user', () => {
    state.authenticated.value = true
    const feedback = useSiteFeedback(route)
    feedback.request()
    expect(feedback.open.value).toBe(true)
    expect(feedback.pageView.value).toBe('hof')
    expect(state.login).not.toHaveBeenCalled()
  })

  it('sends anonymous users to login at the same location without opening the form', () => {
    const feedback = useSiteFeedback(route)
    feedback.request()
    expect(state.login).toHaveBeenCalledWith({ path: '/', query: route.query, hash: '#top' })
    expect(feedback.open.value).toBe(false)
  })

  it('does nothing past the connectivity gate when offline', () => {
    state.online = false
    const feedback = useSiteFeedback(route)
    feedback.request()
    expect(state.login).not.toHaveBeenCalled()
    expect(feedback.open.value).toBe(false)
  })

  it('only produces page views the API accepts', () => {
    for (const view of ALLOWED_VIEWS) expect(view).toMatch(/^[a-z0-9-]{1,64}$/)
  })
})
