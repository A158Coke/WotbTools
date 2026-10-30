// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AnalysisResultPanel from './AnalysisResultPanel.vue'

const state = vi.hoisted(() => ({ t: key => key === 'recon.copy_footer' ? 'footer' : key }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: state.t, te: () => false }) }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ token: () => 'token', ensureToken: async () => true }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => true }) }))
const dialogStub = { props: ['open'], template: '<div v-if="open"><slot /></div>' }
const team = {
  teamPlayers: [{ playerKey: 'p', displayName: 'Player', tankName: 'Tank' }],
  teamReview: { summary: { verdict: 'verdict', primaryDiagnosis: 'diagnosis' },
    episodes: [{ id: 'e', title: 'episode', analysis: 'analysis', startSec: null, endSec: null }],
    trainingSuggestions: [{ title: 'train', content: 'practice' }],
    reviewFocus: [{ playerKey: 'p', episodeId: 'e', reason: 'focus' }], highContributors: [] },
  preBattleSection: 'excluded prebattle',
}
let writeText
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '1', createdAt: '2026-01-01T00:00:00Z' }, { status: 201 })))
})
afterEach(() => { delete navigator.clipboard; vi.unstubAllGlobals() })

function mountPanel(result) {
  return mount(AnalysisResultPanel, { props: { result }, global: { mocks: { $t: state.t }, stubs: { AppDialog: dialogStub } } })
}

describe('feedback snapshot', () => {
  it.each([{ analysis: 'Player analysis', preBattleSection: 'excluded prebattle' }, team])('matches the actual copied payload', async result => {
    const wrapper = mountPanel(result)
    await wrapper.get('[data-test="copy-analysis-btn"]').trigger('click')
    await wrapper.get('[data-test="feedback-btn"]').trigger('click')
    await wrapper.get('textarea').setValue('details')
    const buttons = wrapper.findAll('button')
    await buttons.find(button => button.text() === 'aiFeedback.submit').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.aiResponseText).toBe(writeText.mock.calls[0][0])
    expect(body.aiResponseText).toContain('footer')
    expect(body.aiResponseText).not.toContain('excluded prebattle')
    expect(wrapper.text()).toContain('aiFeedback.success')
  })

  it('allows multiple reasons and preserves input after a failure', async () => {
    fetch.mockRejectedValueOnce(new TypeError('network'))
    const wrapper = mountPanel({ analysis: 'report' })
    await wrapper.get('[data-test="feedback-btn"]').trigger('click')
    const submit = () => wrapper.findAll('button').find(button => button.text() === 'aiFeedback.submit')
    expect(submit().attributes('disabled')).toBeDefined()
    const reasons = wrapper.findAll('button').filter(button => button.text().startsWith('aiFeedback.reasons.'))
    await reasons[0].trigger('click'); await reasons[1].trigger('click')
    await wrapper.get('textarea').setValue('keep this')
    await submit().trigger('click'); await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('keep this')
    expect(reasons[0].attributes('aria-pressed')).toBe('true')
    expect(reasons[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('closes the form when the result changes and snapshots the new result on reopening', async () => {
    const wrapper = mountPanel({ analysis: 'old' })
    await wrapper.get('[data-test="feedback-btn"]').trigger('click')
    expect(wrapper.find('textarea').exists()).toBe(true)
    await wrapper.setProps({ result: { analysis: 'new' } })
    expect(wrapper.find('textarea').exists()).toBe(false)
    await wrapper.get('[data-test="feedback-btn"]').trigger('click')
    await wrapper.get('textarea').setValue('details')
    await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.submit').trigger('click')
    await flushPromises()
    expect(JSON.parse(fetch.mock.calls[0][1].body).aiResponseText).toBe('new\nfooter')
  })
})
