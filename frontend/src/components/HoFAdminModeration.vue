<script setup lang="ts">
// 名人堂管理 · 百场 / 三环审核分区（kind 选领域）。每个实例各自持有列表、筛选、选择集与审核详情状态；
// 工作区 = 队列（左）+ HoFReviewPane（证据 / 申报确认对照 / 校验清单 / 决定栏）；小屏单条全屏详情。
import { computed, nextTick, onActivated, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { apiErrorLabel, formatDateTimeMinute as fmtTime, replayValueLabel } from '../utils/display.js'
import { HUNDRED_VEHICLES } from '../utils/hundredVehicles.js'
import AppDialog from './AppDialog.vue'
import HoFAdminBulkDeleteDialog from './HoFAdminBulkDeleteDialog.vue'
import HoFReviewPane from './HoFReviewPane.vue'
import HoFReviewQueue from './HoFReviewQueue.vue'
import {
  MODERATION_DOMAINS, fmtSize, formatNumber, reasonError,
  type ModerationDetail, type ModerationKind, type ModerationRow, type ReplayEvidence,
} from './HoFAdminModeration.js'
import { createSelection, uniqueValues } from './HoFAdminSelection.js'

const props = defineProps<{ kind: ModerationKind; size: number }>()
const emit = defineEmits<{ 'update:size': [size: number] }>()

const { t, te, tm } = useI18n()
const { requireFeature } = useFeatureGate()
const { isExpanded } = useBreakpoint()
// kind 在实例生命周期内不变：父组件按 kind 设 key，两个领域各是一个缓存实例。
const domain = MODERATION_DOMAINS[props.kind]
const prefix = domain.prefix

// ── 列表与筛选 ──
const rows = ref<ModerationRow[]>([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const totalPages = ref(0)
const totalItems = ref(0)
const status = ref('')
const nation = ref('')
const vehicleType = ref('')
const vehicleId = ref<number | null>(null)
let gen = 0

const nations = uniqueValues(HUNDRED_VEHICLES.map(vehicle => vehicle.nation))
const vehicleTypes = uniqueValues(HUNDRED_VEHICLES.map(vehicle => vehicle.vehicleType))
const filteredVehicles = computed(() => HUNDRED_VEHICLES.filter(vehicle =>
  (!nation.value || vehicle.nation === nation.value)
    && (!vehicleType.value || vehicle.vehicleType === vehicleType.value)))

const selection = createSelection(rows)
const bulkOpen = ref(false)

// ── 详情（所有状态共用；只有详情内才可执行状态操作）──
const target = ref<ModerationRow | null>(null)
const detail = ref<ModerationDetail | null>(null)
const reviewLoading = ref(false)
const phase = ref('view') // view | approve-confirm | reject-form | delete-form
const rejectReason = ref('')
const rejectText = ref('')
const deleteReason = ref('')
const deleteText = ref('')
const msg = ref('')
const busy = ref(false)
// 管理员文件证据（仅 PENDING）
const evidence = ref<ReplayEvidence[]>([])
const evidenceLoading = ref(false)
const evidenceError = ref('')
const zoomSrc = ref('')
// stale-response guard：详情请求与证据请求分别计代；openReview(A) → loadEvidence(A) 后立刻 openReview(B)，
// 若 A 的请求最后才返回，禁止 A 的 detail / evidence 覆盖当前 B。
let reviewGen = 0
let evidenceGen = 0

async function load() {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const g = ++gen
  loading.value = true
  error.value = ''
  try {
    const res = await domain.list({
      page: page.value,
      size: props.size,
      status: status.value,
      nation: nation.value,
      vehicleType: vehicleType.value,
      vehicleId: vehicleId.value,
    })
    if (g !== gen) return
    rows.value = res.items || []
    totalPages.value = res.totalPages || 0
    totalItems.value = res.totalItems || 0
    selection.prune()
  } catch (e) {
    if (g === gen) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === gen) loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

function onVehicleFilterChange() {
  if (vehicleId.value && !filteredVehicles.value.some(vehicle => vehicle.id === Number(vehicleId.value))) {
    vehicleId.value = null
  }
  search()
}

function goPage(p: number) {
  page.value = p
  load()
}

async function onSizeChange(event: Event) {
  emit('update:size', Number((event.target as HTMLSelectElement).value))
  await nextTick()
  search()
}

function onBulkSettled(failedIds: number[]) {
  selection.keepOnly(failedIds)
  load()
}

function statusLabel(s: string | null | undefined) {
  if (!s) return '-'
  const key = `${prefix}.status.${s}`
  return te(key) ? t(key) : String(s)
}

type ReasonKind = 'reject' | 'delete'

function reasonOptions(kind: ReasonKind): Record<string, string> {
  const options: unknown = tm(`${prefix}.${kind}ReasonOptions`)
  return options && typeof options === 'object' ? options as Record<string, string> : {}
}

function reasonLabel(kind: ReasonKind, reason: string | null | undefined) {
  if (!reason) return '-'
  return reasonOptions(kind)[reason] || reason
}

// ── 详情与证据 ──
async function openReview(row: ModerationRow) {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const g = ++reviewGen
  ++evidenceGen
  target.value = row
  detail.value = null
  reviewLoading.value = true
  phase.value = 'view'
  msg.value = ''
  busy.value = false
  rejectReason.value = ''
  rejectText.value = ''
  deleteReason.value = ''
  deleteText.value = ''
  evidence.value = []
  evidenceLoading.value = false
  evidenceError.value = ''
  zoomSrc.value = ''
  try {
    const value = await domain.detail(row.id)
    if (g !== reviewGen) return
    detail.value = value
    if (value.status === 'PENDING') loadEvidence(row.id)
  } catch (e) {
    if (g === reviewGen) msg.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === reviewGen) reviewLoading.value = false
  }
}

/** 加载 MANUAL PENDING 的 replay evidence 元数据（旧记录可能为空）。 */
async function loadEvidence(submissionId: number) {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const g = ++evidenceGen
  evidenceLoading.value = true
  evidenceError.value = ''
  try {
    const list = (await domain.replays(submissionId)) || []
    if (g !== evidenceGen) return // 过期响应：当前已打开别的 submission，丢弃
    evidence.value = list
  } catch (e) {
    if (g !== evidenceGen) return
    evidenceError.value = apiErrorLabel(t, te, e)
    evidence.value = []
  } finally {
    if (g === evidenceGen) evidenceLoading.value = false
  }
}

function closeReview() {
  if (busy.value) return
  ++reviewGen
  ++evidenceGen
  target.value = null
  detail.value = null
  evidence.value = []
  evidenceError.value = ''
  msg.value = ''
  zoomSrc.value = ''
}

const screenshots = computed(() => domain.screenshots(detail.value))
const zoomTitle = computed(() => (domain.zoomTitleParams
  ? t(`${prefix}.screenshot`, domain.zoomTitleParams)
  : t(`${prefix}.screenshot`)))

/** 下载截图：base64 data URL 直接触发浏览器下载（无需后端端点）。 */
function downloadScreenshot(index: number) {
  const src = screenshots.value[index]
  if (!src) return
  const anchor = document.createElement('a')
  anchor.href = src
  anchor.download = domain.screenshotName(src, index)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** 下载单个 replay evidence（authenticated download API）。 */
async function downloadReplay(raw: unknown) {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const ev = evidence.value.find(item => item === raw)
  if (!target.value || !ev) return
  try {
    await domain.replayDownload(target.value.id, ev.id)
  } catch (e) {
    evidenceError.value = apiErrorLabel(t, te, e)
  }
}

// ── 决定：通过 / 拒绝 / 删除 ──
function setPhase(next: 'view' | 'approve-confirm' | 'reject-form' | 'delete-form') {
  if (next === 'delete-form') {
    deleteReason.value = ''
    deleteText.value = ''
  }
  msg.value = ''
  phase.value = next
}

type Decision = 'approve' | ReasonKind
type Request = (id: number) => Promise<unknown>

/** 返回请求函数，或 reason 校验失败时的提示文案。 */
function requestFor(kind: Decision): Request | string {
  if (kind === 'approve') return id => domain.approve(id)
  if (kind === 'reject') {
    const invalid = reasonError(t, prefix, kind, rejectReason.value, rejectText.value)
    if (invalid) return invalid
    const text = rejectText.value.trim()
    const body = { rejectReason: rejectReason.value, ...(text ? { rejectReasonText: text } : {}) }
    return id => domain.reject(id, body)
  }
  const invalid = reasonError(t, prefix, kind, deleteReason.value, deleteText.value)
  if (invalid) return invalid
  const text = deleteText.value.trim()
  const body = { deleteReason: deleteReason.value, ...(text ? { deleteReasonText: text } : {}) }
  return id => domain.remove(id, body)
}

async function decide(kind: Decision) {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  if (busy.value || !target.value) return
  const call = requestFor(kind)
  if (typeof call === 'string') {
    msg.value = call
    return
  }
  busy.value = true
  msg.value = ''
  // 结果按提交时的记录 ID 关联：返回时若当前审核对象已不是它，不把结果 / 错误套到别的记录上
  const submissionId = target.value.id
  try {
    await call(submissionId)
  } catch (e) {
    if (target.value?.id === submissionId) msg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    busy.value = false
  }
  if (target.value?.id === submissionId) closeReview()
  load()
}

// ── 工作区投影 ──
const REPLAY_CHECKS = [['replayParseOk', 'valParsed'], ['replayGameIdMatch', 'valGameId'], ['replayVehicleMatch', 'valVehicle'], ['replayDistinctBattles', 'valDistinct']] as const

const evidenceComplete = computed(() => detail.value?.status === 'PENDING'
  && domain.screenshotsComplete(detail.value)
  && evidence.value.length === 5
  && !evidenceError.value)

const queue = computed(() => rows.value.map((row) => {
  const damage = formatNumber(domain.queueDamage(row))
  return {
    id: row.id, title: row.nicknameSnapshot || '-', status: String(row.status), statusLabel: statusLabel(row.status),
    sub: damage === '-' ? row.vehicleName : t('hofAdmin.reviewAvg', { vehicle: row.vehicleName, value: damage }),
    time: fmtTime(row.submittedAt) || '-', checked: selection.isSelected(row),
  }
}))

const position = computed(() => {
  const index = rows.value.findIndex(row => row.id === target.value?.id)
  return index < 0 ? 0 : index + 1
})

const pane = computed(() => {
  const d = detail.value
  const item = (label: string, value: string | null | undefined) => ({ label, value: value ?? '-' })
  const meta = [
    item(t(`${prefix}.vehicle`), d?.vehicleName),
    item(t(`${prefix}.gameId`), d ? `${d.wotbServer}·${d.wotbAccountId}` : '-'),
    item(t(`${prefix}.submittedAt`), fmtTime(d?.submittedAt) || '-'),
  ]
  if (d?.approvedAt) meta.push(item(t(`${prefix}.approvedAt`), fmtTime(d.approvedAt) || '-'))
  if (d?.status === 'REJECTED') {
    meta.push(item(t(`${prefix}.rejectReason`), reasonLabel('reject', d.rejectReason)))
    if (d.rejectReasonText) meta.push(item(t(`${prefix}.rejectReasonTextValue`), d.rejectReasonText))
    meta.push(item(t(`${prefix}.rejectedAt`), fmtTime(d.rejectedAt) || '-'))
  }
  if (d?.status === 'CANCELLED') meta.push(item(t(`${prefix}.cancelledAt`), fmtTime(d.cancelledAt) || '-'))
  if (d?.status === 'DELETED') {
    meta.push(item(t(`${prefix}.deleteReason`), reasonLabel('delete', d.deleteReason)))
    if (d.deleteReasonText) meta.push(item(t(`${prefix}.deleteReasonTextValue`), d.deleteReasonText))
    meta.push(item(t(`${prefix}.deletedAt`), fmtTime(d.deletedAt) || '-'))
  }
  // 通过时后端把申报值原样写入确认值（HundredModerationService / Mark3ModerationService），所以待审核时「确认」列展示将被记录的值。
  const confirmed = (approved: number | null | undefined, claimed: number | null | undefined) => approved != null ? approved : d?.status === 'PENDING' ? claimed : null
  return {
    prefix, title: d ? `${d.nicknameSnapshot} · ${d.vehicleName}` : '', status: String(d?.status ?? ''), statusLabel: statusLabel(d?.status),
    meta, loading: reviewLoading.value, phase: phase.value, busy: busy.value, message: msg.value,
    compare: d ? domain.compare(t, d, confirmed) : [],
    checks: d ? REPLAY_CHECKS.map(([field, key]) => ({ ok: !!d[field], label: t(`${prefix}.${key}`) })) : [],
    evidenceLoading: evidenceLoading.value, evidenceError: evidenceError.value, evidenceComplete: evidenceComplete.value,
    screenshots: screenshots.value,
    replays: evidence.value.map(ev => ({ id: ev.id, slot: ev.slot, name: ev.originalFilename, sizeLabel: fmtSize(ev.fileSize), raw: ev })),
    position: position.value, total: rows.value.length, compact: !isExpanded.value,
    rejectReasons: reasonOptions('reject'), deleteReasons: reasonOptions('delete'),
  }
})

// 通过 / 拒绝 / 删除请求在途时不换目标：openReview 会重置 busy 并替换当前条，
// 首个请求返回后会关掉新选中的条目或把错误显示到错误的记录上
function step(delta: number) {
  const next = rows.value[position.value - 1 + delta]
  if (next && !busy.value) openReview(next)
}
const openById = (id: number) => {
  const row = rows.value.find(item => item.id === id)
  if (row && !busy.value) openReview(row)
}
const toggleById = (id: number, on: boolean) => selection.toggle(rows.value.find(row => row.id === id), on)

onActivated(() => { if (!rows.value.length) load() })
defineExpose({ reload: load })
</script>

<template>
  <div :class="`hof-${kind}`">
    <div class="hof-admin-filters">
      <select v-model="nation" @change="onVehicleFilterChange">
        <option value="">{{ $t(`${domain.filterPrefix}.allNations`) }}</option>
        <option v-for="value in nations" :key="value" :value="value">{{ replayValueLabel(t, te, value) }}</option>
      </select>
      <select v-model="vehicleType" @change="onVehicleFilterChange">
        <option value="">{{ $t(`${domain.filterPrefix}.allVehicleTypes`) }}</option>
        <option v-for="value in vehicleTypes" :key="value" :value="value">{{ replayValueLabel(t, te, value) }}</option>
      </select>
      <select v-model="vehicleId" @change="search">
        <option :value="null">{{ $t(`${domain.filterPrefix}.allVehicles`) }}</option>
        <option v-for="vehicle in filteredVehicles" :key="vehicle.id" :value="vehicle.id">{{ vehicle.name }}</option>
      </select>
      <select v-model="status" @change="search">
        <option value="">{{ $t(`${prefix}.statusAll`) }}</option>
        <option v-for="value in domain.statuses" :key="value" :value="value">{{ $t(`${prefix}.status.${value}`) }}</option>
      </select>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="selection.count()" class="hof-bulk-bar">
      <span class="hof-bulk-count">{{ $t('hofAdmin.selectedCount', { count: selection.count() }) }}</span>
      <button class="btn-sm danger" @click="bulkOpen = true">{{ $t('hofAdmin.bulkDelete') }}</button>
      <button class="btn-sm" @click="selection.clear()">{{ $t('hofAdmin.clearSelection') }}</button>
    </div>
    <p v-if="loading" class="muted">{{ $t(`${prefix}.loading`) }}</p>
    <p v-else-if="!rows.length" class="muted">{{ $t(`${prefix}.empty`) }}</p>
    <div v-else class="hof-review-layout">
      <HoFReviewQueue :items="queue" :current-id="target?.id ?? null" :all-selected="selection.allSelected()" :label="$t('hofAdmin.reviewQueue')" :busy="busy"
        @open="openById" @toggle="toggleById" @toggle-all="selection.toggleAll($event)" />
      <HoFReviewPane v-if="target" v-bind="pane" v-model:reject-reason="rejectReason" v-model:reject-text="rejectText" v-model:delete-reason="deleteReason" v-model:delete-text="deleteText"
        @close="closeReview" @prev="step(-1)" @next="step(1)" @ask-reject="setPhase('reject-form')" @ask-approve="setPhase('approve-confirm')" @ask-delete="setPhase('delete-form')" @cancel="setPhase('view')"
        @confirm-approve="decide('approve')" @confirm-reject="decide('reject')" @confirm-delete="decide('delete')" @download-screenshot="downloadScreenshot" @zoom="zoomSrc = screenshots[$event] || ''" @download-replay="downloadReplay" />
      <p v-else class="hof-review-empty">{{ $t('hofAdmin.reviewPick') }}</p>
    </div>
    <div v-if="totalPages > 1" class="pagination">
      <button :disabled="page <= 1" @click="goPage(page - 1)">{{ $t(`${prefix}.prev`) }}</button>
      <span>{{ $t(`${prefix}.pageInfo`, { page, total: totalPages, items: totalItems }) }}</span>
      <button :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t(`${prefix}.next`) }}</button>
    </div>
    <label class="page-size">{{ $t(`${prefix}.size`) }}
      <select :value="size" @change="onSizeChange">
        <option :value="20">20</option>
        <option :value="50">50</option>
        <option :value="100">100</option>
      </select>
    </label>

    <!-- 截图放大（lightbox） -->
    <AppDialog
      :open="!!zoomSrc"
      :title="zoomTitle"
      size="lg"
      scrim-class="screenshot-zoom"
      @close="zoomSrc = ''"
    >
      <img class="screenshot-zoom-img" :src="zoomSrc" :alt="zoomTitle" />
      <template #actions>
        <button type="button" class="btn-sm" @click="zoomSrc = ''">{{ $t(`${prefix}.zoomClose`) }}</button>
      </template>
    </AppDialog>

    <HoFAdminBulkDeleteDialog v-model:open="bulkOpen" :domain="kind" :ids="selection.selected.value" @settled="onBulkSettled" />
  </div>
</template>

<style scoped src="./HoFAdminShared.css"></style>
