// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import AdminSiteFeedbackPage from './AdminSiteFeedbackPage.vue'

const api = vi.hoisted(() => ({
  listSiteFeedback: vi.fn(), getSiteFeedback: vi.fn(), deleteSiteFeedback: vi.fn(), updateSiteFeedbackStatus: vi.fn(),
  siteFeedbackReasons: ['BUG', 'OTHER'], feedbackStatuses: ['PENDING', 'FIXED'],
}))
const gate = vi.hoisted(() => ({ status: null }))
vi.mock('../api/site-feedback.js', () => api)
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, te: () => false }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({
  requireFeature: () => gate.status.value.available,
  availability: () => gate.status.value,
}) }))
const row = { id: '1', reasonCodes: ['BUG'], feedbackText: 'feedback', pageView: 'hof', createdAt: '2026-01-01T00:00:00Z', status: 'PENDING' }
const dialogStub = { props: ['open'], template: '<div v-if="open"><slot /></div>' }
const mountPage = () => mount(AdminSiteFeedbackPage, { global: { mocks: { $t: key => key }, stubs: { AppDialog: dialogStub } } })
const detailStatusText = wrapper => wrapper.findAll('p').map(p => p.text()).find(text => text.startsWith('siteFeedback.statusLabel'))
beforeEach(() => {
  vi.clearAllMocks()
  row.status = 'PENDING'
  gate.status = ref({ available: true, pending: false })
  api.listSiteFeedback.mockResolvedValue({ items: [row], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  api.getSiteFeedback.mockResolvedValue(row)
  api.deleteSiteFeedback.mockResolvedValue(undefined)
  api.updateSiteFeedbackStatus.mockResolvedValue(undefined)
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

it('does not send a status update when the admin feedback feature is unavailable', async () => {
  const wrapper = mountPage()
  await flushPromises()
  gate.status.value = { available: false, pending: false }
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateSiteFeedbackStatus).not.toHaveBeenCalled()
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
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

it('displays the server status, saves a confirmed change and re-reads it on refresh', async () => {
  const wrapper = mountPage()
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateSiteFeedbackStatus).toHaveBeenCalledTimes(1)
  expect(api.updateSiteFeedbackStatus).toHaveBeenCalledWith('1', 'FIXED')
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  api.listSiteFeedback.mockResolvedValueOnce({ items: [{ ...row, status: 'FIXED' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.refresh').trigger('click')
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
})

it('keeps the previous status when the server explicitly rejects the update', async () => {
  api.updateSiteFeedbackStatus.mockRejectedValueOnce({ status: 400, errorCode: 'INVALID_REQUEST' })
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateSiteFeedbackStatus).toHaveBeenCalledWith('1', 'FIXED')
  expect(api.getSiteFeedback).not.toHaveBeenCalled()
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
})

it('re-reads the server status when an update outcome is ambiguous', async () => {
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.view').trigger('click')
  await flushPromises()
  api.updateSiteFeedbackStatus.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  api.getSiteFeedback.mockResolvedValueOnce({ ...row, status: 'FIXED' })
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateSiteFeedbackStatus).toHaveBeenCalledTimes(1)
  expect(api.getSiteFeedback).toHaveBeenCalledTimes(2)
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toContain('siteFeedback.status.FIXED')
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})

it('reports an unconfirmed status when reconciliation also fails', async () => {
  api.updateSiteFeedbackStatus.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  api.getSiteFeedback.mockRejectedValueOnce(new Error('offline'))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(api.updateSiteFeedbackStatus).toHaveBeenCalledTimes(1)
  expect(api.getSiteFeedback).toHaveBeenCalledWith('1')
  expect(wrapper.get('.status-select').element.value).toBe('PENDING')
  expect(wrapper.get('[role="alert"]').text()).toContain('siteFeedback.statusUnconfirmed')
})

it('disables the status control while saving and ignores duplicate submissions', async () => {
  let resolveUpdate
  api.updateSiteFeedbackStatus.mockImplementationOnce(() => new Promise(resolve => { resolveUpdate = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  expect(wrapper.get('.status-select').element.disabled).toBe(true)
  await wrapper.get('.status-select').setValue('FIXED')
  expect(api.updateSiteFeedbackStatus).toHaveBeenCalledTimes(1)
  resolveUpdate()
  await flushPromises()
  expect(wrapper.get('.status-select').element.disabled).toBe(false)
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
})

it('does not let a stale list response overwrite a confirmed status', async () => {
  const wrapper = mountPage()
  await flushPromises()
  let resolveList
  api.listSiteFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveList = resolve }))
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.refresh').trigger('click')
  await flushPromises()
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  resolveList({ items: [{ ...row, status: 'PENDING' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
})

it('ignores a stale detail response that predates a confirmed status', async () => {
  let resolveDetail
  api.getSiteFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.view').trigger('click')
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  resolveDetail({ ...row, status: 'PENDING' })
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toBeUndefined()
})

it('does not let a pre-update detail response overwrite the status after a list refresh', async () => {
  let resolveDetail
  api.getSiteFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.view').trigger('click')
  await wrapper.get('.status-select').setValue('FIXED')
  await flushPromises()
  api.listSiteFeedback.mockResolvedValueOnce({ items: [{ ...row, status: 'FIXED' }], page: 0, size: 25, totalItems: 1, totalPages: 1 })
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.refresh').trigger('click')
  await flushPromises()
  resolveDetail({ ...row, status: 'PENDING' })
  await flushPromises()
  expect(wrapper.get('.status-select').element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toBeUndefined()
  api.getSiteFeedback.mockResolvedValueOnce({ ...row, status: 'FIXED' })
  await wrapper.findAll('button').find(button => button.text() === 'siteFeedback.view').trigger('click')
  await flushPromises()
  expect(detailStatusText(wrapper)).toContain('siteFeedback.status.FIXED')
})

it('keeps another record detail loading when a status update succeeds', async () => {
  const second = { ...row, id: '2', feedbackText: 'second feedback' }
  api.listSiteFeedback.mockResolvedValueOnce({ items: [row, second], page: 0, size: 25, totalItems: 2, totalPages: 1 })
  let resolveUpdate
  let resolveDetail
  api.updateSiteFeedbackStatus.mockImplementationOnce(() => new Promise(resolve => { resolveUpdate = resolve }))
  api.getSiteFeedback.mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('.status-select').at(0).setValue('FIXED')
  await wrapper.findAll('button').filter(button => button.text() === 'siteFeedback.view').at(1).trigger('click')
  await flushPromises()
  expect(api.getSiteFeedback).toHaveBeenCalledWith('2')
  resolveUpdate()
  await flushPromises()
  resolveDetail({ ...second, feedbackText: 'second exact feedback', status: 'PENDING' })
  await flushPromises()
  expect(wrapper.findAll('.status-select').at(0).element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toContain('siteFeedback.status.PENDING')
  expect(wrapper.get('pre').text()).toBe('second exact feedback')
})

it('keeps another record detail loading when an ambiguous status is reconciled', async () => {
  const second = { ...row, id: '2', feedbackText: 'second feedback' }
  api.listSiteFeedback.mockResolvedValueOnce({ items: [row, second], page: 0, size: 25, totalItems: 2, totalPages: 1 })
  api.updateSiteFeedbackStatus.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  let resolveReadback
  let resolveDetail
  api.getSiteFeedback
    .mockImplementationOnce(() => new Promise(resolve => { resolveReadback = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve }))
  const wrapper = mountPage()
  await flushPromises()
  await wrapper.findAll('.status-select').at(0).setValue('FIXED')
  await flushPromises()
  expect(api.getSiteFeedback).toHaveBeenCalledWith('1')
  await wrapper.findAll('button').filter(button => button.text() === 'siteFeedback.view').at(1).trigger('click')
  await flushPromises()
  expect(api.getSiteFeedback).toHaveBeenCalledWith('2')
  resolveReadback({ ...row, status: 'FIXED' })
  await flushPromises()
  resolveDetail({ ...second, feedbackText: 'second exact feedback', status: 'PENDING' })
  await flushPromises()
  expect(wrapper.findAll('.status-select').at(0).element.value).toBe('FIXED')
  expect(detailStatusText(wrapper)).toContain('siteFeedback.status.PENDING')
  expect(wrapper.get('pre').text()).toBe('second exact feedback')
})
