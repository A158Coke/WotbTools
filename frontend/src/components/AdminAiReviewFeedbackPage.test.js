// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog'
import AdminAiReviewFeedbackPage from './AdminAiReviewFeedbackPage.vue'

const api = vi.hoisted(() => ({
  listFeedback: vi.fn(), getFeedback: vi.fn(), deleteFeedback: vi.fn(), updateFeedbackStatus: vi.fn(),
  feedbackReasons: ['FACT_ERROR', 'OTHER'], feedbackStatuses: ['PENDING', 'FIXED'],
}))
const gate = vi.hoisted(() => ({ status: null }))
vi.mock('../api/ai-review-feedback.js', () => api)
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, te: () => false }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({
  requireFeature: () => gate.status.value.available,
  availability: () => gate.status.value,
}) }))
const row = { id: '1', reasonCodes: ['FACT_ERROR'], feedbackText: 'feedback', model: null, createdAt: '2026-01-01T00:00:00Z', status: 'PENDING' }
const globalOptions = { mocks: { $t: key => key }, provide: { [DIALOG_INLINE_KEY]: true } }
const detailStatusText = wrapper => {
  const node = wrapper.find('[data-testid="feedback-detail-status"]')
  return node.exists() ? node.text() : undefined
}
const mountPage = () => mount(AdminAiReviewFeedbackPage, { global: globalOptions })
beforeEach(() => {
  vi.clearAllMocks()
  row.status = 'PENDING'
  gate.status = ref({ available: true, pending: false })
  api.listFeedback.mockResolvedValue({ items: [row], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  api.getFeedback.mockResolvedValue({ ...row, aiResponseText: 'exact reply\nraw' })
  api.deleteFeedback.mockResolvedValue(undefined)
  api.updateFeedbackStatus.mockResolvedValue(undefined)
})

it('loads exactly once when initial connectivity settles online and does not show an unrequested empty list', async () => {
  gate.status.value = { available: false, pending: true }
  const wrapper = mount(AdminAiReviewFeedbackPage, { global: globalOptions })
  await flushPromises()
  expect(api.listFeedback).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('aiFeedback.empty')
  gate.status.value = { available: true, pending: false }
  await flushPromises()
  expect(api.listFeedback).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('feedback')
  gate.status.value = { available: false, pending: false }; await flushPromises()
  gate.status.value = { available: true, pending: false }; await flushPromises()
  expect(api.listFeedback).toHaveBeenCalledTimes(1)
})

it('clears old rows when a filter request fails and retries the selected query', async () => {
  const wrapper = mount(AdminAiReviewFeedbackPage, { global: globalOptions })
  await flushPromises()
  expect(wrapper.text()).toContain('feedback')
  api.listFeedback.mockRejectedValueOnce(new Error('failed'))
  await wrapper.get('select').setValue('FACT_ERROR'); await flushPromises()
  expect(wrapper.find('tbody').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('aiFeedback.empty')
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.refresh').trigger('click'); await flushPromises()
  expect(api.listFeedback).toHaveBeenLastCalledWith(0, 'FACT_ERROR')
  expect(wrapper.text()).toContain('feedback')
})

it('does not display page one rows as page two when pagination fails', async () => {
  api.listFeedback.mockResolvedValueOnce({ items: [row], page: 0, size: 25, totalItems: 26, totalPages: 2 })
  const wrapper = mount(AdminAiReviewFeedbackPage, { global: globalOptions })
  await flushPromises()
  api.listFeedback.mockRejectedValueOnce(new Error('failed'))
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.next').trigger('click'); await flushPromises()
  expect(wrapper.find('tbody').exists()).toBe(false)
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.previous').trigger('click'); await flushPromises()
  expect(api.listFeedback).toHaveBeenLastCalledWith(0, '')
})

it('filters on the server, displays original detail and confirms deletion', async () => {
  const wrapper = mount(AdminAiReviewFeedbackPage, { global: globalOptions })
  await flushPromises()
  expect(api.listFeedback).toHaveBeenCalledWith(0, '')
  await wrapper.get('select').setValue('FACT_ERROR')
  await flushPromises()
  expect(api.listFeedback).toHaveBeenLastCalledWith(0, 'FACT_ERROR')
  await wrapper.get('[data-testid="feedback-row-open"]').trigger('click')
  await flushPromises()
  const drawer = wrapper.get('[data-testid="admin-detail-drawer"]')
  expect(drawer.attributes('role')).toBe('dialog')
  expect(drawer.findAll('pre').at(-1).text()).toBe('exact reply\nraw')
  // 删除在抽屉底部两段式确认：第一步只展开确认，不发请求
  await drawer.get('[data-testid="admin-danger-start"]').trigger('click')
  expect(api.deleteFeedback).not.toHaveBeenCalled()
  await drawer.get('[data-testid="admin-danger-confirm"]').trigger('click')
  await flushPromises()
  expect(api.deleteFeedback).toHaveBeenCalledWith('1')
  expect(api.listFeedback).toHaveBeenLastCalledWith(0, 'FACT_ERROR')
})

it('requests the next server page and ignores a stale filter response', async () => {
  api.listFeedback.mockResolvedValueOnce({ items: [row], page: 0, size: 25, totalItems: 26, totalPages: 2 })
  const wrapper = mount(AdminAiReviewFeedbackPage, { global: globalOptions })
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

// --- #923 管理员可维护状态（行内状态下拉；详情抽屉只显示服务器确认的状态）---
it('does not send a status update when the admin feedback feature is unavailable', async () => {
  const wrapper = mountPage()
  await flushPromises()
  gate.status.value = { available: false, pending: false }
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateFeedbackStatus).not.toHaveBeenCalled()
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
})

it('displays the server status, saves a confirmed change and re-reads it on refresh', async () => {
  const wrapper = mountPage()
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateFeedbackStatus).toHaveBeenCalledTimes(1)
  expect(api.updateFeedbackStatus).toHaveBeenCalledWith('1', 'FIXED')
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  api.listFeedback.mockResolvedValueOnce({ items: [{ ...row, status: 'FIXED' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.refresh').trigger('click')
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
})

it('keeps the previous status when the server explicitly rejects the update', async () => {
  api.updateFeedbackStatus.mockRejectedValueOnce({ status: 400, errorCode: 'INVALID_REQUEST' })
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateFeedbackStatus).toHaveBeenCalledWith('1', 'FIXED')
  expect(api.getFeedback).not.toHaveBeenCalled()
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
})

it('re-reads the server status when an update outcome is ambiguous', async () => {
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('[data-testid="feedback-row-open"]').trigger('click')
  await flushPromises()
  api.updateFeedbackStatus.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  api.getFeedback.mockResolvedValueOnce({ ...row, status: 'FIXED', aiResponseText: 'exact reply\nraw' })
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateFeedbackStatus).toHaveBeenCalledTimes(1)
  expect(api.getFeedback).toHaveBeenCalledTimes(2)
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toContain('aiFeedback.status.FIXED')
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})

it('reports an unconfirmed status when reconciliation also fails', async () => {
  api.updateFeedbackStatus.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  api.getFeedback.mockRejectedValueOnce(new Error('offline'))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateFeedbackStatus).toHaveBeenCalledTimes(1)
  expect(api.getFeedback).toHaveBeenCalledWith('1')
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
  expect(wrapper.get('[role="alert"]').text()).toContain('aiFeedback.statusUnconfirmed')
})

it('disables the status control while saving and ignores duplicate submissions', async () => {
  let resolveUpdate
  api.updateFeedbackStatus.mockImplementationOnce(() => new Promise(resolve => { resolveUpdate = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(wrapper.get('.status-select').element.disabled).toBe(true)
  await wrapper.get('.status-select').setValue('FIXED')
  expect(api.updateFeedbackStatus).toHaveBeenCalledTimes(1)
  resolveUpdate()
  await flushPromises()
  expect(wrapper.get('.status-select').element.disabled).toBe(false)
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
})

it('does not let a stale list response overwrite a confirmed status', async () => {
  const wrapper = mountPage()
  await flushPromises()
  let resolveList
  api.listFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveList = resolve }))
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.refresh').trigger('click')
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  resolveList({ items: [{ ...row, status: 'PENDING' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
})

it('ignores a stale detail response that predates a confirmed status', async () => {
  let resolveDetail
  api.getFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('[data-testid="feedback-row-open"]').trigger('click')
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  resolveDetail({ ...row, aiResponseText: 'exact reply\nraw', status: 'PENDING' })
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toBeUndefined()
})

it('does not let a pre-update detail response overwrite the status after a list refresh', async () => {
  let resolveDetail
  api.getFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('[data-testid="feedback-row-open"]').trigger('click')
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  api.listFeedback.mockResolvedValueOnce({ items: [{ ...row, status: 'FIXED' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await wrapper.findAll('button').find(button => button.text() === 'aiFeedback.refresh').trigger('click')
  await flushPromises()
  resolveDetail({ ...row, aiResponseText: 'exact reply\nraw', status: 'PENDING' })
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toBeUndefined()
  api.getFeedback.mockResolvedValueOnce({ ...row, status: 'FIXED', aiResponseText: 'exact reply\nraw' })
  await wrapper.get('[data-testid="feedback-row-open"]').trigger('click')
  await flushPromises()
  expect(detailStatusText(wrapper)).toContain('aiFeedback.status.FIXED')
})

it('keeps another record detail loading when a status update succeeds', async () => {
  const second = { ...row, id: '2', feedbackText: 'second feedback' }
  api.listFeedback.mockResolvedValueOnce({ items: [row, second], page: 0, size: 25, totalItems: 2, totalPages: 1 })
  let resolveUpdate
  let resolveDetail
  api.updateFeedbackStatus.mockImplementationOnce(() => new Promise(resolve => { resolveUpdate = resolve }))
  api.getFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('.status-select').at(0).setValue('FIXED')
  await wrapper.findAll('[data-testid="feedback-row-open"]').at(1).trigger('click')
  await flushPromises()
  expect(api.getFeedback).toHaveBeenCalledWith('2')
  resolveUpdate()
  await flushPromises()
  resolveDetail({ ...second, aiResponseText: 'second exact reply', status: 'PENDING' })
  await flushPromises()
  expect(wrapper.findAll('.status-select').at(0).element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toContain('aiFeedback.status.PENDING')
  expect(wrapper.findAll('pre').at(-1).text()).toBe('second exact reply')
})

it('keeps another record detail loading when an ambiguous status is reconciled', async () => {
  const second = { ...row, id: '2', feedbackText: 'second feedback' }
  api.listFeedback.mockResolvedValueOnce({ items: [row, second], page: 0, size: 25, totalItems: 2, totalPages: 1 })
  api.updateFeedbackStatus.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  let resolveReadback
  let resolveDetail
  api.getFeedback
    .mockImplementationOnce(() => new Promise(resolve => { resolveReadback = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('.status-select').at(0).setValue('FIXED')
  await flushPromises()
  expect(api.getFeedback).toHaveBeenCalledWith('1')
  await wrapper.findAll('[data-testid="feedback-row-open"]').at(1).trigger('click')
  await flushPromises()
  expect(api.getFeedback).toHaveBeenCalledWith('2')
  resolveReadback({ ...row, status: 'FIXED' })
  await flushPromises()
  resolveDetail({ ...second, aiResponseText: 'second exact reply', status: 'PENDING' })
  await flushPromises()
  expect(wrapper.findAll('.status-select').at(0).element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toContain('aiFeedback.status.PENDING')
  expect(wrapper.findAll('pre').at(-1).text()).toBe('second exact reply')
})
