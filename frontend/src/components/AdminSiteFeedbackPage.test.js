// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import AdminSiteFeedbackPage from './AdminSiteFeedbackPage.vue'

const api = vi.hoisted(() => ({
  listSiteFeedback: vi.fn(), getSiteFeedback: vi.fn(), deleteSiteFeedback: vi.fn(),
  siteFeedbackReasons: ['BUG', 'OTHER'],
}))
const gate = vi.hoisted(() => ({ status: null }))
vi.mock('../api/site-feedback.js', () => api)
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, te: () => false }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({
  requireFeature: () => gate.status.value.available,
  availability: () => gate.status.value,
}) }))
const row = { id: '1', reasonCodes: ['BUG'], feedbackText: 'feedback', pageView: 'hof', createdAt: '2026-01-01T00:00:00Z' }
const dialogStub = { props: ['open'], template: '<div v-if="open"><slot /></div>' }
const mountPage = () => mount(AdminSiteFeedbackPage, { global: { mocks: { $t: key => key }, stubs: { AppDialog: dialogStub } } })
beforeEach(() => {
  vi.clearAllMocks()
  gate.status = ref({ available: true, pending: false })
  api.listSiteFeedback.mockResolvedValue({ items: [row], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  api.getSiteFeedback.mockResolvedValue(row)
  api.deleteSiteFeedback.mockResolvedValue(undefined)
})

it('loads exactly once when initial connectivity settles online', async () => {
  gate.status.value = { available: false, pending: true }
  const wrapper = mountPage()
  await flushPromises()
  expect(api.listSiteFeedback).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('siteFeedback.empty')
  gate.status.value = { available: true, pending: false }
  await flushPromises()
  expect(api.listSiteFeedback).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('hof')
})

it('filters by reason from the first page', async () => {
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('select').setValue('BUG')
  await flushPromises()
  expect(api.listSiteFeedback).toHaveBeenLastCalledWith(0, 'BUG')
})

it('shows details and deletes after confirmation', async () => {
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.view').trigger('click')
  await flushPromises()
  expect(api.getSiteFeedback).toHaveBeenCalledWith('1')
  expect(wrapper.get('pre').text()).toBe('feedback')
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.delete').trigger('click')
  const confirm = wrapper.findAll('button').filter(button => button.text() === 'siteFeedback.delete').at(-1)
  await confirm.trigger('click')
  await flushPromises()
  expect(api.deleteSiteFeedback).toHaveBeenCalledWith('1')
  expect(api.listSiteFeedback).toHaveBeenCalledTimes(2)
})
