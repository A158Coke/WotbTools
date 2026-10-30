// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminAiReviewFeedbackPage from './AdminAiReviewFeedbackPage.vue'

const api = vi.hoisted(() => ({
  listFeedback: vi.fn(), getFeedback: vi.fn(), deleteFeedback: vi.fn(),
  feedbackReasons: ['FACT_ERROR', 'OTHER'],
}))
vi.mock('../api/ai-review-feedback.js', () => api)
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, te: () => false }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => true }) }))
const row = { id: '1', reasonCodes: ['FACT_ERROR'], feedbackText: 'feedback', model: null, createdAt: '2026-01-01T00:00:00Z' }
const dialogStub = { props: ['open'], template: '<div v-if="open"><slot /></div>' }
beforeEach(() => {
  vi.clearAllMocks()
  api.listFeedback.mockResolvedValue({ items: [row], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  api.getFeedback.mockResolvedValue({ ...row, aiResponseText: 'exact reply\nraw' })
  api.deleteFeedback.mockResolvedValue(undefined)
})

it('filters on the server, displays original detail and confirms deletion', async () => {
  const wrapper = mount(AdminAiReviewFeedbackPage, { global: { mocks: { $t: key => key }, stubs: { AppDialog: dialogStub } } })
  await flushPromises()
  expect(api.listFeedback).toHaveBeenCalledWith(0, '')
  await wrapper.get('select').setValue('FACT_ERROR')
  await flushPromises()
  expect(api.listFeedback).toHaveBeenLastCalledWith(0, 'FACT_ERROR')
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.view').trigger('click')
  await flushPromises()
  expect(wrapper.get('pre:last-of-type').text()).toBe('exact reply\nraw')
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.delete').trigger('click')
  expect(api.deleteFeedback).not.toHaveBeenCalled()
  await wrapper.findAll('button').filter(button => button.text() === 'aiFeedback.delete').at(-1).trigger('click')
  await flushPromises()
  expect(api.deleteFeedback).toHaveBeenCalledWith('1')
  expect(api.listFeedback).toHaveBeenLastCalledWith(0, 'FACT_ERROR')
})

it('requests the next server page and ignores a stale filter response', async () => {
  api.listFeedback.mockResolvedValueOnce({ items: [row], page: 0, size: 25, totalItems: 26, totalPages: 2 })
  const wrapper = mount(AdminAiReviewFeedbackPage, { global: { mocks: { $t: key => key }, stubs: { AppDialog: dialogStub } } })
  await flushPromises()
  api.listFeedback.mockResolvedValueOnce({ items: [{ ...row, id: '2' }], page: 1, size: 25, totalItems: 26, totalPages: 2 })
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.next').trigger('click')
  await flushPromises()
  expect(api.listFeedback).toHaveBeenLastCalledWith(1, '')
  let resolveOld
  api.listFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  api.listFeedback.mockResolvedValueOnce({ items: [{ ...row, id: '3', feedbackText: 'fresh' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await wrapper.get('select').setValue('FACT_ERROR')
  await wrapper.get('select').setValue('OTHER')
  await flushPromises()
  resolveOld({ items: [{ ...row, feedbackText: 'stale' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await flushPromises()
  expect(wrapper.text()).toContain('fresh')
  expect(wrapper.text()).not.toContain('stale')
})
