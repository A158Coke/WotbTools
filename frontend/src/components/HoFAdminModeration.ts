// 百场 / 三环审核的领域差异表：两者是同一套人工审核流程（列表 → 详情 → 证据 → 通过 / 拒绝 / 删除），
// 只在 API 族、i18n 前缀、状态集合、截图形态与对照行上不同。状态由 HoFAdminModeration.vue 的每个实例各自持有；
// 请求与 wire 校验仍只在 api/hall-of-fame.ts。
import type { components } from '../api/generated/http-contract.js'
import * as api from '../api/hall-of-fame.js'

type Schemas = components['schemas']
type Translate = (key: string, params?: Record<string, unknown>) => string

export type ModerationKind = 'hundred' | 'mark3'

/** 组件读取的列表行字段（两个领域生成类型的公共视图；百场列表没有申报值）。 */
export interface ModerationRow {
  id: number
  status: string
  vehicleName: string
  nicknameSnapshot: string
  submittedAt?: string | null
  claimedAverageDamage?: number | null
  approvedAverageDamage?: number | null
}

/** 组件读取的详情字段（两个领域生成类型的公共视图）。 */
export interface ModerationDetail extends ModerationRow {
  wotbServer: string
  wotbAccountId: number
  claimedAverageDamage: number
  claimedBattleCount: number
  claimedWinRate?: number | null
  approvedBattleCount?: number | null
  approvedWinRate?: number | null
  proofScreenshot?: string | null
  proofScreenshots?: string[]
  replayParseOk: boolean
  replayGameIdMatch: boolean
  replayVehicleMatch: boolean
  replayDistinctBattles: boolean
  approvedAt?: string | null
  rejectedAt?: string | null
  rejectReason?: string | null
  rejectReasonText?: string | null
  cancelledAt?: string | null
  deletedAt?: string | null
  deleteReason?: string | null
  deleteReasonText?: string | null
}

export interface ReplayEvidence { id: number; slot: number; originalFilename: string; fileSize: number }
export interface CompareRow { label: string; claimed: string; confirmed: string }
type Confirmed = (approved: number | null | undefined, claimed: number | null | undefined) => number | null | undefined
interface ListParams { page: number; size: number; status: string; nation: string; vehicleType: string; vehicleId: number | null }
interface ListPage { items: ModerationRow[]; totalPages: number; totalItems: number }
interface RejectBody { rejectReason: string; rejectReasonText?: string }
interface DeleteBody { deleteReason: string; deleteReasonText?: string }
interface BulkBody { reason: string; reasonText?: string }

interface ModerationDomain {
  prefix: 'hundredAdmin' | 'mark3Admin'
  filterPrefix: ModerationKind
  statuses: readonly string[]
  list: (params: ListParams) => Promise<ListPage>
  detail: (id: number) => Promise<ModerationDetail>
  replays: (id: number) => Promise<ReplayEvidence[] | null | undefined>
  replayDownload: (id: number, evidenceId: number) => Promise<unknown>
  approve: (id: number) => Promise<unknown>
  reject: (id: number, body: RejectBody) => Promise<unknown>
  remove: (id: number, body: DeleteBody) => Promise<unknown>
  bulkDelete: (ids: number[], body: BulkBody) => Promise<Schemas['BulkDeleteResult']>
  screenshots: (detail: ModerationDetail | null) => string[]
  screenshotsComplete: (detail: ModerationDetail) => boolean
  screenshotName: (src: string, index: number) => string
  zoomTitleParams: Record<string, string> | undefined
  queueDamage: (row: ModerationRow) => number | null | undefined
  compare: (t: Translate, detail: ModerationDetail, confirmed: Confirmed) => CompareRow[]
}

export function formatNumber(value: number | string | null | undefined) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '-'
}

function formatWinRate(value: number | string | null | undefined) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number)
    ? `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : '-'
}

export function fmtSize(bytes: number | null | undefined) {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

function screenshotFileName(src: string) {
  const m = /^data:image\/([a-z0-9+]+);/i.exec(src)
  return m ? ('screenshot.' + (m[1] === 'jpeg' ? 'jpg' : m[1])) : 'screenshot.png'
}

/** 单条与批量删除共用的 reason 规则：必填；选择「其他」时必须带补充说明。 */
export function reasonError(t: Translate, prefix: string, kind: 'reject' | 'delete', reason: string, text: string) {
  if (!reason) return t(`${prefix}.${kind}ReasonRequired`)
  if (reason === 'OTHER' && !text.trim()) return t(`${prefix}.${kind}ReasonText`)
  return ''
}

// 三环请求体的 reason 是后端枚举；前端值只来自同一枚举生成的 i18n 选项 key，越界值由后端拒绝。
type Mark3Reject = Schemas['Mark3RejectRequest']
type Mark3Delete = Schemas['Mark3DeleteRequest']

export const MODERATION_DOMAINS: Record<ModerationKind, ModerationDomain> = {
  hundred: {
    prefix: 'hundredAdmin',
    filterPrefix: 'hundred',
    statuses: ['PENDING', 'CURRENT', 'REJECTED', 'SUPERSEDED', 'CANCELLED', 'DELETED'],
    list: params => api.hofAdminHundredList(params),
    detail: id => api.hofAdminHundredDetail(id),
    replays: id => api.hofAdminHundredReplays(id),
    replayDownload: (id, evidenceId) => api.hofAdminHundredReplayDownload(id, evidenceId),
    approve: id => api.hofAdminHundredApprove(id),
    reject: (id, body) => api.hofAdminHundredReject(id, body),
    remove: (id, body) => api.hofAdminHundredDelete(id, body),
    bulkDelete: (ids, body) => api.hofAdminBulkDeleteHundred(ids, body),
    screenshots: d => (d?.proofScreenshot ? [d.proofScreenshot] : []),
    // 与 backend approve invariant 对齐：必须有截图 + exactly 5 行 evidence。
    screenshotsComplete: d => Boolean(d.proofScreenshot),
    screenshotName: src => screenshotFileName(src),
    zoomTitleParams: undefined,
    queueDamage: row => row.approvedAverageDamage ?? row.claimedAverageDamage,
    compare: (t, d, confirmed) => [
      { label: t('hofAdmin.reviewDamage'), claimed: formatNumber(d.claimedAverageDamage), confirmed: formatNumber(confirmed(d.approvedAverageDamage, d.claimedAverageDamage)) },
      { label: t('hofAdmin.reviewBattles'), claimed: formatNumber(d.claimedBattleCount), confirmed: formatNumber(confirmed(d.approvedBattleCount, d.claimedBattleCount)) },
    ],
  },
  // 三环仅人工证据；状态不含 SUPERSEDED；没有改分字段。
  mark3: {
    prefix: 'mark3Admin',
    filterPrefix: 'mark3',
    statuses: ['PENDING', 'CURRENT', 'REJECTED', 'CANCELLED', 'DELETED'],
    list: params => api.hofAdminMark3List(params),
    detail: id => api.hofAdminMark3Detail(id),
    replays: id => api.hofAdminMark3Replays(id),
    replayDownload: (id, evidenceId) => api.hofAdminMark3ReplayDownload(id, evidenceId),
    approve: id => api.hofAdminMark3Approve(id),
    reject: (id, body) => api.hofAdminMark3Reject(id, body as Mark3Reject),
    remove: (id, body) => api.hofAdminMark3Delete(id, body as Mark3Delete),
    bulkDelete: (ids, body) => api.hofAdminBulkDeleteMark3(ids, body),
    screenshots: d => d?.proofScreenshots ?? [],
    screenshotsComplete: (d) => {
      const screenshots = d.proofScreenshots
      return Array.isArray(screenshots) && screenshots.length >= 1 && screenshots.length <= 2
    },
    screenshotName: (src, index) => `mark3-${index + 1}-${screenshotFileName(src)}`,
    zoomTitleParams: { number: '' },
    queueDamage: row => row.claimedAverageDamage,
    compare: (t, d, confirmed) => {
      const winRate = confirmed(d.approvedWinRate, d.claimedWinRate)
      return [
        { label: t('hofAdmin.reviewBattles'), claimed: formatNumber(d.claimedBattleCount), confirmed: formatNumber(confirmed(d.approvedBattleCount, d.claimedBattleCount)) },
        { label: t('hofAdmin.reviewDamage'), claimed: formatNumber(d.claimedAverageDamage), confirmed: formatNumber(confirmed(d.approvedAverageDamage, d.claimedAverageDamage)) },
        { label: t('hofAdmin.reviewWinRate'), claimed: formatWinRate(d.claimedWinRate), confirmed: winRate == null ? '-' : formatWinRate(winRate) },
      ]
    },
  },
}
