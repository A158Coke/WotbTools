// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import HoFAdminPage from './HoFAdminPage.vue'

const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined))
}))

const hofAdminApi = vi.hoisted(() => ({
  hofAdminList: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofAdminAudit: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofAdminDelete: vi.fn(() => Promise.resolve(undefined)),
  hofAdminDownload: vi.fn(() => Promise.resolve(undefined)),
  hofAdminHundredList: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofAdminHundredDetail: vi.fn(() => Promise.resolve({})),
  hofAdminHundredApprove: vi.fn(() => Promise.resolve({ status: 'CURRENT' })),
  hofAdminHundredReject: vi.fn(() => Promise.resolve({ status: 'REJECTED' })),
  hofAdminHundredDelete: vi.fn(() => Promise.resolve(undefined))
}))

let roles = ['HoF-admin']
let authenticated = true

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(authenticated),
    tokenParsed: ref(roles.length ? { realm_access: { roles } } : null),
    login: api.login
  })
}))

vi.mock('../utils/api.js', () => hofAdminApi)
vi.mock('../utils/helpers.js', () => ({ mapLabel: () => '' }))
vi.mock('../utils/display.js', () => ({ apiErrorLabel: (t, te, e) => (e?.code ? 'err:' + e.code : 'api-error') }))
// 三语 reason options（object message：tm/$tm 才返回 object；$t 只用于字符串 key）
const REJECT_OPTIONS = {
  SCREENSHOT_MISMATCH: '截图数据与申报不符',
  SCREENSHOT_UNREADABLE: '截图无法识别',
  INSUFFICIENT_PROOF: '截图不足以证明百场成绩',
  SUSPECTED_FRAUD: '疑似伪造',
  OTHER: '其他'
}
const DELETE_OPTIONS = {
  CHEATING_FORGERY: '作弊 / 伪造',
  WRONG_REVIEW: '错误审核',
  PLAYER_IDENTITY_ISSUE: '玩家身份问题',
  DATA_ERROR: '数据错误',
  ADMIN_CORRECTION: '管理员纠错',
  OTHER: '其他'
}
const optionMessages = (key) => {
  if (key === 'hundredAdmin.rejectReasonOptions') return REJECT_OPTIONS
  if (key === 'hundredAdmin.deleteReasonOptions') return DELETE_OPTIONS
  return {}
}
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: k => k, te: () => true, tm: optionMessages, locale: ref('zh') }) }))

const pendingItem = {
  id: 11, status: 'PENDING', vehicleId: 6481, vehicleName: 'FV4005',
  gameAccountIdSnapshot: 'game-123', nicknameSnapshot: 'SnapUser',
  claimedAverageDamage: 4200, claimedBattleCount: 100,
  approvedAverageDamage: null, approvedBattleCount: null,
  replayParseOk: true, replayGameIdMatch: true, replayVehicleMatch: true, replayDistinctBattles: true,
  submittedAt: '2024-01-01T00:00:00Z', approvedAt: null, rejectReason: null, deleteReason: null
}

const currentItem = {
  id: 12, status: 'CURRENT', vehicleId: 6491, vehicleName: 'E 100',
  gameAccountIdSnapshot: 'game-456', nicknameSnapshot: 'CurUser',
  claimedAverageDamage: 3800, claimedBattleCount: 120,
  approvedAverageDamage: 3800, approvedBattleCount: 120,
  replayParseOk: true, replayGameIdMatch: true, replayVehicleMatch: true, replayDistinctBattles: true,
  submittedAt: '2023-12-01T00:00:00Z', approvedAt: '2023-12-02T00:00:00Z', rejectReason: null, deleteReason: null
}

const pendingDetail = {
  ...pendingItem,
  proofScreenshot: '/api/screenshots/11.png',
  replayParseOk: true, replayGameIdMatch: false, replayVehicleMatch: true, replayDistinctBattles: true
}

describe('HoFAdminPage', () => {
  beforeEach(() => {
    roles = ['HoF-admin']
    authenticated = true
    vi.clearAllMocks()
  })

  function mountPage() {
    return mount(HoFAdminPage, { global: { mocks: { $t: k => k, $tm: optionMessages } } })
  }

  async function switchToHundred(wrapper) {
    await wrapper.findAll('.hof-admin-tabs button')[2].trigger('click')
    await flushPromises()
  }

  it('HoF-admin sees admin content and loads records', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.hof-admin-denied').exists()).toBe(false)
    expect(hofAdminApi.hofAdminList).toHaveBeenCalled()
  })

  it('wotbtools-admin sees admin content', async () => {
    roles = ['wotbtools-admin']
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.hof-admin-denied').exists()).toBe(false)
    expect(hofAdminApi.hofAdminList).toHaveBeenCalled()
  })

  it('normal user sees denied state and no admin API call', async () => {
    roles = ['wotbtools-user']
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.hof-admin-denied').exists()).toBe(true)
    expect(hofAdminApi.hofAdminList).not.toHaveBeenCalled()
  })

  it('anonymous triggers login before rendering admin content', async () => {
    authenticated = false
    roles = []
    const wrapper = mountPage()
    await flushPromises()
    expect(api.login).toHaveBeenCalledWith('hof-admin')
    expect(hofAdminApi.hofAdminList).not.toHaveBeenCalled()
  })

  it('delete requires confirmation then calls delete API', async () => {
    hofAdminApi.hofAdminList.mockResolvedValue({
      items: [{
        id: 7, arenaId: 'a1', accountId: 111, nickname: 'Player1', tankId: 6481, tankName: 'FV4005',
        battleType: 'RANDOM', arenaBonusType: 1, damageDealt: 5000, mapName: 'rockfield',
        version: '11.18.0', battleTime: null, createdAt: '2024-01-01T00:00:00Z',
        replayHash: 'h', replayFileName: 'x.wotbreplay', replaySize: 100,
        replayUploadedBy: 'up-sub', replayAvailable: true
      }],
      page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    // 单击垃圾桶 → 弹确认，绝不立即执行删除
    await wrapper.findAll('.actions .danger')[0].trigger('click')
    expect(hofAdminApi.hofAdminDelete).not.toHaveBeenCalled()
    expect(wrapper.find('.hof-delete-modal').exists()).toBe(true)
    // 确认 → 调用删除 API
    await wrapper.findAll('.modal-actions .danger')[0].trigger('click')
    expect(hofAdminApi.hofAdminDelete).toHaveBeenCalledWith(7)
  })

  it('hundred tab renders submission list with status filter', async () => {
    hofAdminApi.hofAdminHundredList.mockResolvedValue({
      items: [pendingItem, currentItem],
      page: 1, size: 50, totalItems: 2, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    await switchToHundred(wrapper)

    expect(hofAdminApi.hofAdminHundredList).toHaveBeenCalledWith({ page: 1, size: 50 })
    const table = wrapper.find('.hof-hundred .hof-admin-table')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('FV4005')
    expect(table.text()).toContain('SnapUser')
    expect(table.text()).toContain('E 100')
    // 状态列渲染
    expect(table.text()).toContain('hundredAdmin.status.PENDING')
    expect(table.text()).toContain('hundredAdmin.status.CURRENT')
    // PENDING 行有审核按钮，CURRENT 行有删除按钮
    expect(wrapper.find('.hof-hundred .actions .btn-sm').exists()).toBe(true)
    expect(wrapper.find('.hof-hundred .actions .btn-sm.danger').exists()).toBe(true)
    // 状态筛选联动刷新
    await wrapper.find('.hof-hundred .hof-admin-filters select').setValue('CURRENT')
    await flushPromises()
    expect(hofAdminApi.hofAdminHundredList).toHaveBeenLastCalledWith({ page: 1, size: 50, status: 'CURRENT' })
  })

  it('PENDING row opens review modal with screenshot and validation items', async () => {
    hofAdminApi.hofAdminHundredList.mockResolvedValue({
      items: [pendingItem],
      page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    hofAdminApi.hofAdminHundredDetail.mockResolvedValue(pendingDetail)
    const wrapper = mountPage()
    await flushPromises()
    await switchToHundred(wrapper)

    await wrapper.find('.hof-hundred .actions .btn-sm').trigger('click')
    await flushPromises()

    expect(hofAdminApi.hofAdminHundredDetail).toHaveBeenCalledWith(11)
    const modal = wrapper.find('.hof-review-modal')
    expect(modal.exists()).toBe(true)
    // 截图
    const img = modal.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/api/screenshots/11.png')
    // 四项 Replay 校验：true → ✓ / false → ✗
    const items = modal.findAll('.val-list li')
    expect(items.length).toBe(4)
    expect(items[0].classes()).toContain('val-ok')
    expect(items[1].classes()).toContain('val-bad')
    expect(items[2].classes()).toContain('val-ok')
    expect(items[3].classes()).toContain('val-ok')
    // 管理员确认输入预填申报值
    const inputs = modal.findAll('.hundred-inputs input')
    expect(inputs.length).toBe(2)
    expect(inputs[0].element.value).toBe('4200')
    expect(inputs[1].element.value).toBe('100')
  })

  it('approve flow confirms then calls approve API and refreshes list', async () => {
    hofAdminApi.hofAdminHundredList.mockResolvedValue({
      items: [pendingItem],
      page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    hofAdminApi.hofAdminHundredDetail.mockResolvedValue(pendingDetail)
    const wrapper = mountPage()
    await flushPromises()
    await switchToHundred(wrapper)

    await wrapper.find('.hof-hundred .actions .btn-sm').trigger('click')
    await flushPromises()

    // 第一次点击「通过」仅进入确认阶段，不调用 API
    const approveBtn = () => wrapper.findAll('.hof-review-modal button').find(b => b.text() === 'hundredAdmin.approve')
    await approveBtn().trigger('click')
    expect(hofAdminApi.hofAdminHundredApprove).not.toHaveBeenCalled()
    expect(wrapper.find('.hof-review-modal').text()).toContain('hundredAdmin.approveConfirm')

    // 确认后调用 approve 并刷新列表
    await approveBtn().trigger('click')
    await flushPromises()
    expect(hofAdminApi.hofAdminHundredApprove).toHaveBeenCalledWith(11, {
      approvedAverageDamage: 4200,
      approvedBattleCount: 100
    })
    expect(hofAdminApi.hofAdminHundredList).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.hof-review-modal').exists()).toBe(false)
  })

  it('reject select renders stable category values from $tm object', async () => {
    hofAdminApi.hofAdminHundredList.mockResolvedValue({
      items: [pendingItem], page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    hofAdminApi.hofAdminHundredDetail.mockResolvedValue(pendingDetail)
    const wrapper = mountPage()
    await flushPromises()
    await switchToHundred(wrapper)
    await wrapper.find('.hof-hundred .actions .btn-sm').trigger('click')
    await flushPromises()

    // 进入拒绝表单
    const rejectBtn = () => wrapper.findAll('.hof-review-modal button').find(b => b.text() === 'hundredAdmin.reject')
    await rejectBtn().trigger('click')
    const select = wrapper.find('.hof-review-modal select')
    const values = select.findAll('option').map(o => o.attributes('value'))
    // option value 必须是 backend 接受的稳定 category（不是字符串字符/索引）
    expect(values).toEqual(['', 'SCREENSHOT_MISMATCH', 'SCREENSHOT_UNREADABLE', 'INSUFFICIENT_PROOF', 'SUSPECTED_FRAUD', 'OTHER'])
    // 选择 category 并确认 → API 收到稳定 category value
    await select.setValue('SCREENSHOT_MISMATCH')
    await wrapper.findAll('.hof-review-modal .modal-actions button').find(b => b.text() === 'hundredAdmin.reject').trigger('click')
    await flushPromises()
    expect(hofAdminApi.hofAdminHundredReject).toHaveBeenCalledWith(11, { rejectReason: 'SCREENSHOT_MISMATCH' })
  })

  it('reject OTHER requires text and sends it with category value', async () => {
    hofAdminApi.hofAdminHundredList.mockResolvedValue({
      items: [pendingItem], page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    hofAdminApi.hofAdminHundredDetail.mockResolvedValue(pendingDetail)
    const wrapper = mountPage()
    await flushPromises()
    await switchToHundred(wrapper)
    await wrapper.find('.hof-hundred .actions .btn-sm').trigger('click')
    await flushPromises()
    await wrapper.findAll('.hof-review-modal button').find(b => b.text() === 'hundredAdmin.reject').trigger('click')

    const select = wrapper.find('.hof-review-modal select')
    await select.setValue('OTHER')
    await wrapper.findAll('.hof-review-modal .modal-actions button').find(b => b.text() === 'hundredAdmin.reject').trigger('click')
    await flushPromises()
    expect(hofAdminApi.hofAdminHundredReject).not.toHaveBeenCalled()

    await wrapper.find('.hof-review-modal textarea').setValue('手工复核发现异常')
    await wrapper.findAll('.hof-review-modal .modal-actions button').find(b => b.text() === 'hundredAdmin.reject').trigger('click')
    await flushPromises()
    expect(hofAdminApi.hofAdminHundredReject).toHaveBeenCalledWith(11, {
      rejectReason: 'OTHER',
      rejectReasonText: '手工复核发现异常'
    })
  })

  it('delete current renders stable category values from $tm object', async () => {
    hofAdminApi.hofAdminHundredList.mockResolvedValue({
      items: [currentItem], page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    await switchToHundred(wrapper)

    await wrapper.find('.hof-hundred .actions .btn-sm.danger').trigger('click')
    const select = wrapper.find('.hof-delete-modal select')
    const values = select.findAll('option').map(o => o.attributes('value'))
    expect(values).toEqual(['', 'CHEATING_FORGERY', 'WRONG_REVIEW', 'PLAYER_IDENTITY_ISSUE', 'DATA_ERROR', 'ADMIN_CORRECTION', 'OTHER'])
    await select.setValue('DATA_ERROR')
    await wrapper.findAll('.hof-delete-modal .modal-actions button').find(b => b.text() === 'hundredAdmin.delete').trigger('click')
    await flushPromises()
    expect(hofAdminApi.hofAdminHundredDelete).toHaveBeenCalledWith(12, { deleteReason: 'DATA_ERROR' })
  })

  it('approve rejects battle count below 100 with local UX hint (backend still authoritative)', async () => {
    hofAdminApi.hofAdminHundredList.mockResolvedValue({
      items: [pendingItem], page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    hofAdminApi.hofAdminHundredDetail.mockResolvedValue(pendingDetail)
    const wrapper = mountPage()
    await flushPromises()
    await switchToHundred(wrapper)
    await wrapper.find('.hof-hundred .actions .btn-sm').trigger('click')
    await flushPromises()

    const inputs = wrapper.findAll('.hundred-inputs input')
    await inputs[1].setValue(99)
    const approveBtn = () => wrapper.findAll('.hof-review-modal button').find(b => b.text() === 'hundredAdmin.approve')
    await approveBtn().trigger('click')
    await approveBtn().trigger('click')
    await flushPromises()
    expect(hofAdminApi.hofAdminHundredApprove).not.toHaveBeenCalled()
    expect(wrapper.find('.hof-review-modal').text()).toContain('hundredAdmin.approvedBattlesMin')
  })
})