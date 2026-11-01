// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteFeedbackDialog from './SiteFeedbackDialog.vue'

const state = vi.hoisted(() => ({ online: true }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, te: () => false }) }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ token: () => 'token', ensureToken: async () => true }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
const dialogStub = { template: '<div><slot /></div>' }

beforeEach(() => {
  state.online = true
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '1', createdAt: '2026-01-01T00:00:00Z' }, { status: 201 })))
})
afterEach(() => vi.unstubAllGlobals())

function mountDialog() {
  return mount(SiteFeedbackDialog, { props: { pageView: 'hof' }, global: { mocks: { $t: key => key }, stubs: { AppDialog: dialogStub } } })
}
const submit = wrapper => wrapper.findAll('button').find(button => button.text() === 'siteFeedback.submit')

describe('site feedback dialog', () => {
  it('submits reasons, text and the current page, then shows the thank-you state', async () => {
    const wrapper = mountDialog()
    expect(submit(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.reasons.BUG').trigger('click')
    await wrapper.get('textarea').setValue('broken')
    await submit(wrapper).trigger('click')
    await flushPromises()
    const [url, options] = fetch.mock.calls[0]
    expect(String(url)).toContain('/api/site-feedback')
    expect(JSON.parse(options.body)).toEqual({ reasonCodes: ['BUG'], feedbackText: 'broken', pageView: 'hof' })
    expect(wrapper.get('[role="status"]').text()).toBe('siteFeedback.success')
    expect(wrapper.find('textarea').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('accepts text without a reason and rejects whitespace or over-long text', async () => {
    const wrapper = mountDialog()
    await wrapper.get('textarea').setValue('   ')
    expect(submit(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('a'.repeat(4001))
    expect(submit(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('siteFeedback.tooLong')
    await wrapper.get('textarea').setValue('😀'.repeat(4000))
    expect(submit(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('preserves input when offline or when the request fails', async () => {
    const wrapper = mountDialog()
    await wrapper.get('textarea').setValue('keep this')
    state.online = false
    await submit(wrapper).trigger('click'); await flushPromises()
    expect(fetch).not.toHaveBeenCalled()
    state.online = true
    fetch.mockRejectedValueOnce(new TypeError('network'))
    await submit(wrapper).trigger('click'); await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('keep this')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
