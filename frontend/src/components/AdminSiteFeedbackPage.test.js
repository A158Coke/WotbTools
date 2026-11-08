// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog'
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
const globalOptions = { mocks: { $t: key => key }, provide: { [DIALOG_INLINE_KEY]: true } }
const mountPage = () => mount(AdminSiteFeedbackPage, { global: globalOptions })
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
  await wrapper.get('[data-testid="feedback-row-open"]').trigger('click')
  await flushPromises()
  const drawer = wrapper.get('[data-testid="admin-detail-drawer"]')
  expect(drawer.attributes('role')).toBe('dialog')
  expect(api.getSiteFeedback).toHaveBeenCalledWith('1')
  expect(drawer.get('pre').text()).toBe('feedback')
  // 删除在抽屉底部两段式确认：第一步只展开确认，不发请求
  await drawer.get('[data-testid="admin-danger-start"]').trigger('click')
  expect(api.deleteSiteFeedback).not.toHaveBeenCalled()
  await drawer.get('[data-testid="admin-danger-confirm"]').trigger('click')
  await flushPromises()
  expect(api.deleteSiteFeedback).toHaveBeenCalledWith('1')
  expect(api.listSiteFeedback).toHaveBeenCalledTimes(2)
})
