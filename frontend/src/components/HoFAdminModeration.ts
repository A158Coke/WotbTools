import type { components } from '../api/generated/http-contract.js'
import * as api from '../api/hall-of-fame.js'

type Schemas = components['schemas']
type Translate = (key: string, params?: Record<string, unknown>) => string

export type ModerationKind = 'hundred' | 'mark3'

export interface ModerationRow {
  id: number
  status: string
  vehicleName: string
  nicknameSnapshot: string
  submittedAt?: string | null
  claimedAverageDamage?: number | null
  approvedAverageDamage?: number | null
}

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
  compare: (t: Translate, detail: ModerationDetail, confirmed: Confirmed, locale: string) => CompareRow[]
}

export function formatNumber(value: number | string | null | undefined, locale: string) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString(locale) : '-'
}

function formatWinRate(value: number | string | null | undefined, locale: string) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number)
    ? (number / 100).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 2 })
    : '-'
}

export function fmtSize(bytes: number | null | undefined, locale: string) {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' KB'
  return (bytes / (1024 * 1024)).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MB'
}

function screenshotFileName(src: string) {
  const m = /^data:image\/([a-z0-9+]+);/i.exec(src)
  return m ? ('screenshot.' + (m[1] === 'jpeg' ? 'jpg' : m[1])) : 'screenshot.png'
}

export function reasonError(t: Translate, prefix: string, kind: 'reject' | 'delete', reason: string, text: string) {
  if (!reason) return t(`${prefix}.${kind}ReasonRequired`)
  if (reason === 'OTHER' && !text.trim()) return t(`${prefix}.${kind}ReasonText`)
  return ''
}

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
    screenshotsComplete: d => Boolean(d.proofScreenshot),
    screenshotName: src => screenshotFileName(src),
    zoomTitleParams: undefined,
    queueDamage: row => row.approvedAverageDamage ?? row.claimedAverageDamage,
    compare: (t, d, confirmed, locale) => [
      { label: t('hofAdmin.reviewDamage'), claimed: formatNumber(d.claimedAverageDamage, locale), confirmed: formatNumber(confirmed(d.approvedAverageDamage, d.claimedAverageDamage), locale) },
      { label: t('hofAdmin.reviewBattles'), claimed: formatNumber(d.claimedBattleCount, locale), confirmed: formatNumber(confirmed(d.approvedBattleCount, d.claimedBattleCount), locale) },
    ],
  },
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
    compare: (t, d, confirmed, locale) => {
      const winRate = confirmed(d.approvedWinRate, d.claimedWinRate)
      return [
        { label: t('hofAdmin.reviewBattles'), claimed: formatNumber(d.claimedBattleCount, locale), confirmed: formatNumber(confirmed(d.approvedBattleCount, d.claimedBattleCount), locale) },
        { label: t('hofAdmin.reviewDamage'), claimed: formatNumber(d.claimedAverageDamage, locale), confirmed: formatNumber(confirmed(d.approvedAverageDamage, d.claimedAverageDamage), locale) },
        { label: t('hofAdmin.reviewWinRate'), claimed: formatWinRate(d.claimedWinRate, locale), confirmed: winRate == null ? '-' : formatWinRate(winRate, locale) },
      ]
    },
  },
}
