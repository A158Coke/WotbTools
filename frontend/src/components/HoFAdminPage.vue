<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel, formatDateTimeMinute, replayValueLabel } from '../utils/display.js'
import { HUNDRED_VEHICLES } from '../utils/hundredVehicles.js'
import * as api from '../utils/api.js'

const { t, te, tm, locale } = useI18n()
const { initPromise, tokenParsed, login } = useAuth()

// 授权在 auth 初始化完成后决定（不先渲染再等 403）；直接访问无权限 → 明确无权限状态。
const canAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (roles.includes('HoF-admin') || roles.includes('wotbtools-admin'))
})

const authPhase = ref('init') // init | login | ready
const denied = ref(false)
const error = ref('')
const activeTab = ref('records')

// ── 名人堂记录 tab ──
const rows = ref([])
const loading = ref(false)
const page = ref(1)
const size = ref(50)
const totalPages = ref(0)
const totalItems = ref(0)
const fNickname = ref('')
const fAccountId = ref('')
const fUploadedBy = ref('')
const fBattleType = ref('')
const fTankId = ref('')
const fReplayAvailable = ref('')
const fSort = ref('')
const vehicleOptions = ref([])
const vehicleOptionsLoading = ref(false)
const fNation = ref('')
const fTankType = ref('')
const fTankTier = ref('')
let gen = 0

const vehicleNations = computed(() => uniqueValues(vehicleOptions.value.map(v => v.nation)))
const vehicleTypes = computed(() => uniqueValues(vehicleOptions.value.map(v => v.type)))
const vehicleTiers = computed(() => uniqueValues(vehicleOptions.value
  .map(v => v.tier)
  .filter(v => v != null))
  .sort((a, b) => a - b))
const filteredVehicles = computed(() => vehicleOptions.value
  .filter(v => (!fNation.value || v.nation === fNation.value)
    && (!fTankType.value || v.type === fTankType.value)
    && (!fTankTier.value || String(v.tier) === fTankTier.value))
  .sort((a, b) => (a.tankName || '').localeCompare(b.tankName || '')))

// ── 操作日志 tab（只读）──
const auditRows = ref([])
const auditLoading = ref(false)
const auditPage = ref(1)
const auditTotalPages = ref(0)
const auditTotalItems = ref(0)
let auditGen = 0

// ── 百场审核 tab ──
const hundredRows = ref([])
const hundredLoading = ref(false)
const hundredPage = ref(1)
const hundredTotalPages = ref(0)
const hundredTotalItems = ref(0)
const hundredStatus = ref('') // '' | PENDING | CURRENT | REJECTED | SUPERSEDED | CANCELLED | DELETED
const hundredNation = ref('')
const hundredVehicleType = ref('')
const hundredVehicleId = ref(null)
let hundredGen = 0

const hundredVehicleOptions = HUNDRED_VEHICLES
const hundredNations = uniqueValues(hundredVehicleOptions.map(vehicle => vehicle.nation))
const hundredVehicleTypes = uniqueValues(hundredVehicleOptions.map(vehicle => vehicle.vehicleType))
const filteredHundredAdminVehicles = computed(() => hundredVehicleOptions.filter(vehicle =>
  (!hundredNation.value || vehicle.nation === hundredNation.value)
    && (!hundredVehicleType.value || vehicle.vehicleType === hundredVehicleType.value)))

// ── 三环审核 tab（仅人工证据；状态不含 SUPERSEDED）──
const mark3Rows = ref([])
const mark3Loading = ref(false)
const mark3Page = ref(1)
const mark3TotalPages = ref(0)
const mark3TotalItems = ref(0)
const mark3Status = ref('')
const mark3Nation = ref('')
const mark3VehicleType = ref('')
const mark3VehicleId = ref(null)
let mark3Gen = 0

const mark3VehicleOptions = HUNDRED_VEHICLES
const mark3Nations = uniqueValues(mark3VehicleOptions.map(vehicle => vehicle.nation))
const mark3VehicleTypes = uniqueValues(mark3VehicleOptions.map(vehicle => vehicle.vehicleType))
const filteredMark3AdminVehicles = computed(() => mark3VehicleOptions.filter(vehicle =>
  (!mark3Nation.value || vehicle.nation === mark3Nation.value)
    && (!mark3VehicleType.value || vehicle.vehicleType === mark3VehicleType.value)))

// ── 百场详情弹窗（所有状态共用；只有详情内才可执行状态操作）──
const reviewTarget = ref(null)
const reviewDetail = ref(null)
const reviewLoading = ref(false)
const reviewPhase = ref('view') // view | approve-confirm | reject-form | delete-form
const rejectReason = ref('')
const rejectReasonText = ref('')
const currentDeleteReason = ref('')
const currentDeleteReasonText = ref('')
const actionMsg = ref('')
const actionBusy = ref(false)
// 详情请求与证据请求分别防止旧响应覆盖当前打开的记录。
let reviewGen = 0

// ── 管理员文件证据（仅 MANUAL PENDING；WG PENDING 使用官方快照）──
const replayEvidence = ref([])
const evidenceLoading = ref(false)
const evidenceError = ref('')
const screenshotZoom = ref(false)
// stale-response guard：openReview(A) → loadEvidence(A) 后立刻 openReview(B)，
// 若 A 的请求最后才返回，禁止 A 的 evidence 覆盖当前 B 的审核弹窗。
let evidenceGen = 0

const WARGAMING_VERIFICATION_SOURCE = 'WARGAMING_API'
const WARGAMING_REGIONS = new Set(['ASIA', 'EU', 'NA'])
const isWargamingReview = computed(
  () => reviewDetail.value?.verificationSource === WARGAMING_VERIFICATION_SOURCE
)
const wargamingSnapshotComplete = computed(() => {
  const detail = reviewDetail.value
  const accountId = Number(detail?.gameAccountIdSnapshot)
  const accountBattles = Number(detail?.officialAccountBattleCount)
  const tankBattles = Number(detail?.officialTankBattleCount)
  const tankDamage = Number(detail?.officialTankDamageDealt)
  const averageDamage = Number(detail?.officialAverageDamage)
  return isWargamingReview.value
    && Boolean(detail?.verifiedAt)
    && WARGAMING_REGIONS.has(detail?.verifiedServer)
    && isIntegerAtLeast(accountId, 1)
    && Boolean(String(detail?.nicknameSnapshot || '').trim())
    && isIntegerAtLeast(accountBattles, 5000)
    && isIntegerAtLeast(tankBattles, 100)
    && tankBattles <= 2_147_483_647
    && tankBattles <= accountBattles
    && isIntegerAtLeast(detail?.officialTankDamageDealt, 0)
    && isIntegerAtLeast(detail?.officialAverageDamage, 0)
    && Math.round(tankDamage / tankBattles) === averageDamage
})

// 与 backend approve invariant 对齐：人工来源必须有截图 + exactly 5 行 evidence；
// WG 来源只认完整官方快照，绝不要求或加载文件证据。
const evidenceComplete = computed(() => {
  if (reviewDetail.value?.status !== 'PENDING') return false
  if (isWargamingReview.value) return wargamingSnapshotComplete.value
  return Boolean(reviewDetail.value?.proofScreenshot)
    && replayEvidence.value.length === 5
    && !evidenceError.value
})
const approveDisabledHint = computed(() => isWargamingReview.value
  ? t('hundredAdmin.wgSnapshotIncomplete')
  : t('hundredAdmin.approveDisabledHint'))

// ── 三环详情弹窗（仅通过、拒绝、删除；没有改分字段）──
const mark3ReviewTarget = ref(null)
const mark3ReviewDetail = ref(null)
const mark3ReviewLoading = ref(false)
const mark3ReviewPhase = ref('view') // view | approve-confirm | reject-form | delete-form
const mark3RejectReason = ref('')
const mark3RejectReasonText = ref('')
const mark3DeleteReason = ref('')
const mark3DeleteReasonText = ref('')
const mark3ActionMsg = ref('')
const mark3ActionBusy = ref(false)
const mark3ReplayEvidence = ref([])
const mark3EvidenceLoading = ref(false)
const mark3EvidenceError = ref('')
const mark3ScreenshotZoom = ref('')
let mark3ReviewGen = 0
let mark3EvidenceGen = 0

const mark3EvidenceComplete = computed(() => {
  if (mark3ReviewDetail.value?.status !== 'PENDING') return false
  const screenshots = mark3ReviewDetail.value?.proofScreenshots
  return Array.isArray(screenshots)
    && screenshots.length >= 1
    && screenshots.length <= 2
    && mark3ReplayEvidence.value.length === 5
    && !mark3EvidenceError.value
})

// ── 删除确认 ──
const deleteTarget = ref(null)
const deleting = ref(false)
const deleteMsg = ref('')

onMounted(async () => {
  let loggedIn = false
  try {
    loggedIn = Boolean(await initPromise)
  } catch {
    loggedIn = false
  }
  if (!loggedIn) {
    authPhase.value = 'login'
    login('hof-admin')
    return
  }
  authPhase.value = 'ready'
  if (!canAdmin.value) {
    denied.value = true
    return
  }
  loadRecords()
  loadVehicleOptions()
})

async function loadRecords() {
  const g = ++gen
  loading.value = true
  error.value = ''
  try {
    const params = {
      page: page.value,
      size: size.value,
      nickname: fNickname.value.trim(),
      accountId: fAccountId.value.trim(),
      uploadedBy: fUploadedBy.value.trim(),
      battleType: fBattleType.value,
      tankId: fTankId.value.trim(),
      nation: fNation.value,
      vehicleType: fTankType.value,
      tier: fTankTier.value,
      replayAvailable: fReplayAvailable.value === '' ? '' : fReplayAvailable.value === 'true',
      sort: fSort.value,
    }
    const res = await api.hofAdminList(params)
    if (g !== gen) return
    rows.value = res.items || []
    totalPages.value = res.totalPages || 0
    totalItems.value = res.totalItems || 0
  } catch (e) {
    if (g === gen) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === gen) loading.value = false
  }
}

async function loadVehicleOptions() {
  vehicleOptionsLoading.value = true
  try {
    vehicleOptions.value = (await api.hofAdminVehicleOptions()) || []
  } catch (e) {
    error.value = apiErrorLabel(t, te, e)
  } finally {
    vehicleOptionsLoading.value = false
  }
}

function onVehicleConditionChange() {
  if (fTankId.value) {
    const selectedTankId = Number(fTankId.value)
    if (!filteredVehicles.value.some(vehicle => vehicle.tankId === selectedTankId)) {
      fTankId.value = ''
    }
  }
  search()
}

function onVehicleChange() {
  search()
}

function vehicleLabel(vehicle) {
  const name = vehicle.tankName || t('hofAdmin.unknownVehicle')
  return vehicle.tier == null ? name : `${name} · T${vehicle.tier}`
}

function vehicleEnumLabel(value) {
  return replayValueLabel(t, te, value)
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

function search() {
  page.value = 1
  loadRecords()
}

function onSizeChange() {
  if (activeTab.value === 'hundred') {
    hundredPage.value = 1
    loadHundred()
  } else if (activeTab.value === 'mark3') {
    mark3Page.value = 1
    loadMark3()
  } else {
    page.value = 1
    loadRecords()
  }
}

function goPage(p) {
  page.value = p
  loadRecords()
}

async function loadAudit() {
  const g = ++auditGen
  auditLoading.value = true
  try {
    const res = await api.hofAdminAudit({ page: auditPage.value, size: size.value })
    if (g !== auditGen) return
    auditRows.value = res.items || []
    auditTotalPages.value = res.totalPages || 0
    auditTotalItems.value = res.totalItems || 0
  } catch (e) {
    if (g === auditGen) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === auditGen) auditLoading.value = false
  }
}

function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'audit' && !auditRows.value.length) loadAudit()
  if (tab === 'hundred' && !hundredRows.value.length) loadHundred()
  if (tab === 'mark3' && !mark3Rows.value.length) loadMark3()
}

async function download(id) {
  try {
    await api.hofAdminDownload(id)
  } catch (e) {
    error.value = apiErrorLabel(t, te, e)
  }
}

// Hard delete 必须二次确认；单击删除不立即执行。
function askDelete(row) {
  deleteTarget.value = row
  deleteMsg.value = ''
}

function cancelDelete() {
  deleteTarget.value = null
  deleteMsg.value = ''
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  deleteMsg.value = ''
  try {
    await api.hofAdminDelete(deleteTarget.value.id)
    cancelDelete()
    await loadRecords()
  } catch (e) {
    deleteMsg.value = apiErrorLabel(t, te, e)
  } finally {
    deleting.value = false
  }
}

// ── 百场审核 ──────────────────────────────────────────────────

async function loadHundred() {
  const g = ++hundredGen
  hundredLoading.value = true
  error.value = ''
  try {
    const params = {
      page: hundredPage.value,
      size: size.value,
      status: hundredStatus.value,
      nation: hundredNation.value,
      vehicleType: hundredVehicleType.value,
      vehicleId: hundredVehicleId.value,
    }
    const res = await api.hofAdminHundredList(params)
    if (g !== hundredGen) return
    hundredRows.value = res.items || []
    hundredTotalPages.value = res.totalPages || 0
    hundredTotalItems.value = res.totalItems || 0
  } catch (e) {
    if (g === hundredGen) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === hundredGen) hundredLoading.value = false
  }
}

function onHundredStatusChange() {
  hundredPage.value = 1
  loadHundred()
}

function onHundredVehicleFilterChange() {
  if (hundredVehicleId.value
      && !filteredHundredAdminVehicles.value.some(vehicle => vehicle.id === Number(hundredVehicleId.value))) {
    hundredVehicleId.value = null
  }
  hundredPage.value = 1
  loadHundred()
}

function onHundredVehicleChange() {
  hundredPage.value = 1
  loadHundred()
}

function goHundredPage(p) {
  hundredPage.value = p
  loadHundred()
}

// ── 三环审核 ──────────────────────────────────────────────────

async function loadMark3() {
  const generation = ++mark3Gen
  mark3Loading.value = true
  error.value = ''
  try {
    const params = {
      page: mark3Page.value,
      size: size.value,
      status: mark3Status.value,
      nation: mark3Nation.value,
      vehicleType: mark3VehicleType.value,
      vehicleId: mark3VehicleId.value,
    }
    const res = await api.hofAdminMark3List(params)
    if (generation !== mark3Gen) return
    mark3Rows.value = res.items || []
    mark3TotalPages.value = res.totalPages || 0
    mark3TotalItems.value = res.totalItems || 0
  } catch (e) {
    if (generation === mark3Gen) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (generation === mark3Gen) mark3Loading.value = false
  }
}

function onMark3StatusChange() {
  mark3Page.value = 1
  loadMark3()
}

function onMark3VehicleFilterChange() {
  if (mark3VehicleId.value
      && !filteredMark3AdminVehicles.value.some(vehicle => vehicle.id === Number(mark3VehicleId.value))) {
    mark3VehicleId.value = null
  }
  mark3Page.value = 1
  loadMark3()
}

function onMark3VehicleChange() {
  mark3Page.value = 1
  loadMark3()
}

function goMark3Page(nextPage) {
  mark3Page.value = nextPage
  loadMark3()
}

function mark3StatusLabel(status) {
  if (!status) return '-'
  const key = 'mark3Admin.status.' + status
  return te(key) ? t(key) : String(status)
}

function hundredStatusLabel(s) {
  if (!s) return '-'
  const k = 'hundredAdmin.status.' + s
  return te(k) ? t(k) : String(s)
}

async function openReview(row) {
  const g = ++reviewGen
  ++evidenceGen
  reviewTarget.value = row
  reviewDetail.value = null
  reviewLoading.value = true
  reviewPhase.value = 'view'
  actionMsg.value = ''
  actionBusy.value = false
  rejectReason.value = ''
  rejectReasonText.value = ''
  currentDeleteReason.value = ''
  currentDeleteReasonText.value = ''
  replayEvidence.value = []
  evidenceLoading.value = false
  evidenceError.value = ''
  screenshotZoom.value = false
  try {
    const detail = await api.hofAdminHundredDetail(row.id)
    if (g !== reviewGen) return
    reviewDetail.value = detail
    if (detail.status === 'PENDING' && detail.verificationSource !== WARGAMING_VERIFICATION_SOURCE) {
      loadEvidence(row.id)
    }
  } catch (e) {
    if (g === reviewGen) actionMsg.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === reviewGen) reviewLoading.value = false
  }
}

/** 加载 MANUAL PENDING 的 replay evidence 元数据（旧记录可能为空）。 */
async function loadEvidence(submissionId) {
  const g = ++evidenceGen
  evidenceLoading.value = true
  evidenceError.value = ''
  try {
    const rows = (await api.hofAdminHundredReplays(submissionId)) || []
    if (g !== evidenceGen) return // 过期响应：当前已打开别的 submission，丢弃
    replayEvidence.value = rows
  } catch (e) {
    if (g !== evidenceGen) return
    evidenceError.value = apiErrorLabel(t, te, e)
    replayEvidence.value = []
  } finally {
    if (g === evidenceGen) evidenceLoading.value = false
  }
}

/** 下载截图：base64 data URL 直接触发浏览器下载（无需后端端点）。 */
function downloadScreenshot() {
  const src = reviewDetail.value?.proofScreenshot
  if (!src) return
  const a = document.createElement('a')
  a.href = src
  a.download = screenshotFileName(src)
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function screenshotFileName(src) {
  const m = /^data:image\/([a-z0-9+]+);/i.exec(src)
  return m ? ('screenshot.' + (m[1] === 'jpeg' ? 'jpg' : m[1])) : 'screenshot.png'
}

/** 下载单个 replay evidence（authenticated download API）。 */
async function downloadReplay(ev) {
  if (!reviewTarget.value) return
  try {
    await api.hofAdminHundredReplayDownload(reviewTarget.value.id, ev.id)
  } catch (e) {
    evidenceError.value = apiErrorLabel(t, te, e)
  }
}

function fmtSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

function isIntegerAtLeast(value, minimum) {
  if (value == null || value === '') return false
  const number = Number(value)
  return Number.isInteger(number) && number >= minimum
}

function formatNumber(value) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '-'
}

function verificationSourceLabel(source) {
  const normalized = source || 'MANUAL'
  const key = `hundredAdmin.verificationSource.${normalized}`
  return te(key) ? t(key) : normalized
}

function verifiedServerLabel(server) {
  if (!server) return '-'
  const key = `hundredAdmin.server.${server}`
  return te(key) ? t(key) : server
}

function closeReview() {
  if (actionBusy.value) return
  ++reviewGen
  ++evidenceGen
  reviewTarget.value = null
  reviewDetail.value = null
  replayEvidence.value = []
  evidenceError.value = ''
  actionMsg.value = ''
  screenshotZoom.value = false
}

function askApprove() {
  actionMsg.value = ''
  reviewPhase.value = 'approve-confirm'
}

function askReject() {
  actionMsg.value = ''
  reviewPhase.value = 'reject-form'
}

async function confirmApprove() {
  if (actionBusy.value || !reviewTarget.value) return
  actionBusy.value = true
  actionMsg.value = ''
  try {
    await api.hofAdminHundredApprove(reviewTarget.value.id)
  } catch (e) {
    actionMsg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    actionBusy.value = false
  }
  closeReview()
  loadHundred()
}

async function confirmReject() {
  if (actionBusy.value || !reviewTarget.value) return
  if (!rejectReason.value) {
    actionMsg.value = t('hundredAdmin.rejectReasonRequired')
    return
  }
  const text = rejectReasonText.value.trim()
  if (rejectReason.value === 'OTHER' && !text) {
    actionMsg.value = t('hundredAdmin.rejectReasonText')
    return
  }
  actionBusy.value = true
  actionMsg.value = ''
  try {
    await api.hofAdminHundredReject(reviewTarget.value.id, {
      rejectReason: rejectReason.value,
      ...(text ? { rejectReasonText: text } : {}),
    })
  } catch (e) {
    actionMsg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    actionBusy.value = false
  }
  closeReview()
  loadHundred()
}

function askCurrentDelete() {
  currentDeleteReason.value = ''
  currentDeleteReasonText.value = ''
  actionMsg.value = ''
  reviewPhase.value = 'delete-form'
}

function cancelCurrentDelete() {
  actionMsg.value = ''
  reviewPhase.value = 'view'
}

async function confirmCurrentDelete() {
  if (actionBusy.value || !reviewTarget.value) return
  if (!currentDeleteReason.value) {
    actionMsg.value = t('hundredAdmin.deleteReasonRequired')
    return
  }
  const text = currentDeleteReasonText.value.trim()
  if (currentDeleteReason.value === 'OTHER' && !text) {
    actionMsg.value = t('hundredAdmin.deleteReasonText')
    return
  }
  actionBusy.value = true
  actionMsg.value = ''
  try {
    await api.hofAdminHundredDelete(reviewTarget.value.id, {
      deleteReason: currentDeleteReason.value,
      ...(text ? { deleteReasonText: text } : {}),
    })
  } catch (e) {
    actionMsg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    actionBusy.value = false
  }
  closeReview()
  loadHundred()
}

async function openMark3Review(row) {
  const generation = ++mark3ReviewGen
  ++mark3EvidenceGen
  mark3ReviewTarget.value = row
  mark3ReviewDetail.value = null
  mark3ReviewLoading.value = true
  mark3ReviewPhase.value = 'view'
  mark3ActionMsg.value = ''
  mark3ActionBusy.value = false
  mark3RejectReason.value = ''
  mark3RejectReasonText.value = ''
  mark3DeleteReason.value = ''
  mark3DeleteReasonText.value = ''
  mark3ReplayEvidence.value = []
  mark3EvidenceLoading.value = false
  mark3EvidenceError.value = ''
  mark3ScreenshotZoom.value = ''
  try {
    const detail = await api.hofAdminMark3Detail(row.id)
    if (generation !== mark3ReviewGen) return
    mark3ReviewDetail.value = detail
    if (detail.status === 'PENDING') loadMark3Evidence(row.id)
  } catch (e) {
    if (generation === mark3ReviewGen) mark3ActionMsg.value = apiErrorLabel(t, te, e)
  } finally {
    if (generation === mark3ReviewGen) mark3ReviewLoading.value = false
  }
}

async function loadMark3Evidence(submissionId) {
  const generation = ++mark3EvidenceGen
  mark3EvidenceLoading.value = true
  mark3EvidenceError.value = ''
  try {
    const evidence = (await api.hofAdminMark3Replays(submissionId)) || []
    if (generation !== mark3EvidenceGen) return
    mark3ReplayEvidence.value = evidence
  } catch (e) {
    if (generation !== mark3EvidenceGen) return
    mark3EvidenceError.value = apiErrorLabel(t, te, e)
    mark3ReplayEvidence.value = []
  } finally {
    if (generation === mark3EvidenceGen) mark3EvidenceLoading.value = false
  }
}

function closeMark3Review() {
  if (mark3ActionBusy.value) return
  ++mark3ReviewGen
  ++mark3EvidenceGen
  mark3ReviewTarget.value = null
  mark3ReviewDetail.value = null
  mark3ReplayEvidence.value = []
  mark3EvidenceError.value = ''
  mark3ActionMsg.value = ''
  mark3ScreenshotZoom.value = ''
}

function downloadMark3Screenshot(src, index) {
  if (!src) return
  const anchor = document.createElement('a')
  anchor.href = src
  anchor.download = `mark3-${index + 1}-${screenshotFileName(src)}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function downloadMark3Replay(evidence) {
  if (!mark3ReviewTarget.value) return
  try {
    await api.hofAdminMark3ReplayDownload(mark3ReviewTarget.value.id, evidence.id)
  } catch (e) {
    mark3EvidenceError.value = apiErrorLabel(t, te, e)
  }
}

function askMark3Approve() {
  mark3ActionMsg.value = ''
  mark3ReviewPhase.value = 'approve-confirm'
}

function askMark3Reject() {
  mark3ActionMsg.value = ''
  mark3ReviewPhase.value = 'reject-form'
}

function askMark3Delete() {
  mark3DeleteReason.value = ''
  mark3DeleteReasonText.value = ''
  mark3ActionMsg.value = ''
  mark3ReviewPhase.value = 'delete-form'
}

async function confirmMark3Approve() {
  if (mark3ActionBusy.value || !mark3ReviewTarget.value) return
  mark3ActionBusy.value = true
  mark3ActionMsg.value = ''
  try {
    await api.hofAdminMark3Approve(mark3ReviewTarget.value.id)
  } catch (e) {
    mark3ActionMsg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    mark3ActionBusy.value = false
  }
  closeMark3Review()
  loadMark3()
}

async function confirmMark3Reject() {
  if (mark3ActionBusy.value || !mark3ReviewTarget.value) return
  if (!mark3RejectReason.value) {
    mark3ActionMsg.value = t('mark3Admin.rejectReasonRequired')
    return
  }
  const text = mark3RejectReasonText.value.trim()
  if (mark3RejectReason.value === 'OTHER' && !text) {
    mark3ActionMsg.value = t('mark3Admin.rejectReasonText')
    return
  }
  mark3ActionBusy.value = true
  mark3ActionMsg.value = ''
  try {
    await api.hofAdminMark3Reject(mark3ReviewTarget.value.id, {
      rejectReason: mark3RejectReason.value,
      ...(text ? { rejectReasonText: text } : {}),
    })
  } catch (e) {
    mark3ActionMsg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    mark3ActionBusy.value = false
  }
  closeMark3Review()
  loadMark3()
}

async function confirmMark3Delete() {
  if (mark3ActionBusy.value || !mark3ReviewTarget.value) return
  if (!mark3DeleteReason.value) {
    mark3ActionMsg.value = t('mark3Admin.deleteReasonRequired')
    return
  }
  const text = mark3DeleteReasonText.value.trim()
  if (mark3DeleteReason.value === 'OTHER' && !text) {
    mark3ActionMsg.value = t('mark3Admin.deleteReasonText')
    return
  }
  mark3ActionBusy.value = true
  mark3ActionMsg.value = ''
  try {
    await api.hofAdminMark3Delete(mark3ReviewTarget.value.id, {
      deleteReason: mark3DeleteReason.value,
      ...(text ? { deleteReasonText: text } : {}),
    })
  } catch (e) {
    mark3ActionMsg.value = apiErrorLabel(t, te, e)
    return
  } finally {
    mark3ActionBusy.value = false
  }
  closeMark3Review()
  loadMark3()
}

function mark3ReasonLabel(kind, reason) {
  if (!reason) return '-'
  const options = tm(`mark3Admin.${kind}ReasonOptions`)
  return options && typeof options === 'object' && options[reason] ? options[reason] : reason
}

function formatMark3WinRate(value) {
  if (value == null || value === '') return '-'
  const number = Number(value)
  return Number.isFinite(number)
    ? `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : '-'
}

function reasonLabel(kind, reason) {
  if (!reason) return '-'
  const options = tm(`hundredAdmin.${kind}ReasonOptions`)
  return options && typeof options === 'object' && options[reason] ? options[reason] : reason
}

const fmtTime = formatDateTimeMinute

function battleTypeLabel(tp) {
  if (tp === 'RATING') return t('hof.battleType.rating')
  if (tp === 'RANDOM') return t('hof.battleType.random')
  return tp || '-'
}
</script>

<template>
  <div class="hof-admin">
    <!-- 登录流程 -->
    <div v-if="authPhase === 'login'" class="hof-admin-login muted">{{ $t('hofAdmin.login') }}</div>

    <!-- 无权限 -->
    <div v-else-if="denied" class="hof-admin-denied">
      <h2>{{ $t('hofAdmin.deniedTitle') }}</h2>
      <p>{{ $t('hofAdmin.deniedHint') }}</p>
    </div>

    <template v-else>
      <div class="hof-admin-tabs">
        <button :class="{ active: activeTab === 'records' }" @click="switchTab('records')">{{ $t('hofAdmin.recordsTab') }}</button>
        <button :class="{ active: activeTab === 'audit' }" @click="switchTab('audit')">{{ $t('hofAdmin.auditTab') }}</button>
        <button :class="{ active: activeTab === 'hundred' }" @click="switchTab('hundred')">{{ $t('hundredAdmin.tab') }}</button>
        <button :class="{ active: activeTab === 'mark3' }" @click="switchTab('mark3')">{{ $t('mark3Admin.tab') }}</button>
      </div>

      <!-- ── 名人堂记录 ── -->
        <div v-if="activeTab === 'records'">
          <div class="hof-admin-filters">
            <input v-model="fNickname" :placeholder="$t('hofAdmin.fNickname')" @keyup.enter="search" />
            <input v-model="fAccountId" :placeholder="$t('hofAdmin.fAccountId')" @keyup.enter="search" />
            <input v-model="fUploadedBy" :placeholder="$t('hofAdmin.fUploadedBy')" @keyup.enter="search" />
            <select v-model="fNation" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
              <option value="">{{ $t('hofAdmin.allNations') }}</option>
              <option v-for="nation in vehicleNations" :key="nation" :value="nation">{{ vehicleEnumLabel(nation) }}</option>
            </select>
            <select v-model="fTankType" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
              <option value="">{{ $t('hofAdmin.allVehicleTypes') }}</option>
              <option v-for="type in vehicleTypes" :key="type" :value="type">{{ vehicleEnumLabel(type) }}</option>
            </select>
            <select v-model="fTankTier" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
              <option value="">{{ $t('hofAdmin.allVehicleTiers') }}</option>
              <option v-for="tier in vehicleTiers" :key="tier" :value="String(tier)">T{{ tier }}</option>
            </select>
            <select v-model="fTankId" :disabled="vehicleOptionsLoading" @change="onVehicleChange">
              <option value="">{{ $t('hofAdmin.allVehicles') }}</option>
              <option v-for="vehicle in filteredVehicles" :key="vehicle.tankId" :value="String(vehicle.tankId)">{{ vehicleLabel(vehicle) }}</option>
            </select>
            <select v-model="fBattleType" @change="search">
            <option value="">{{ $t('hofAdmin.battleTypeAll') }}</option>
            <option value="RANDOM">{{ $t('hof.battleType.random') }}</option>
            <option value="RATING">{{ $t('hof.battleType.rating') }}</option>
          </select>
          <select v-model="fReplayAvailable" @change="search">
            <option value="">{{ $t('hofAdmin.replayAll') }}</option>
            <option value="true">{{ $t('hofAdmin.replayAvailable') }}</option>
            <option value="false">{{ $t('hofAdmin.replayMissing') }}</option>
          </select>
          <select v-model="fSort" @change="search">
            <option value="">{{ $t('hofAdmin.sortDamage') }}</option>
            <option value="battle_time">{{ $t('hofAdmin.sortBattleTime') }}</option>
            <option value="upload_time">{{ $t('hofAdmin.sortUploadTime') }}</option>
          </select>
          <button class="btn-sm" @click="search">{{ $t('hofAdmin.search') }}</button>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="loading" class="muted">{{ $t('hofAdmin.loading') }}</p>
        <p v-else-if="!rows.length" class="muted">{{ $t('hofAdmin.empty') }}</p>
        <div v-else class="tablewrap">
          <table class="hof-admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{{ $t('hofAdmin.player') }}</th>
                <th>{{ $t('hofAdmin.accountId') }}</th>
                <th>{{ $t('hofAdmin.tank') }}</th>
                <th>{{ $t('hofAdmin.battleType') }}</th>
                <th>{{ $t('hofAdmin.damage') }}</th>
                <th>{{ $t('hofAdmin.map') }}</th>
                <th>{{ $t('hofAdmin.version') }}</th>
                <th>{{ $t('hofAdmin.battleTime') }}</th>
                <th>{{ $t('hofAdmin.uploadTime') }}</th>
                <th>{{ $t('hofAdmin.replayHash') }}</th>
                <th>{{ $t('hofAdmin.replaySize') }}</th>
                <th>{{ $t('hofAdmin.uploadedBy') }}</th>
                <th>{{ $t('hofAdmin.replay') }}</th>
                <th>{{ $t('hofAdmin.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td class="muted">{{ r.id }}</td>
                <td>{{ r.nickname }}</td>
                <td class="muted">{{ r.accountId }}</td>
                <td>{{ r.tankName }}</td>
                <td><span class="bt-badge" :class="r.battleType === 'RATING' ? 'bt-rating' : 'bt-random'">{{ battleTypeLabel(r.battleType) }}</span></td>
                <td class="dmg">{{ r.damageDealt.toLocaleString() }}</td>
                <td>{{ mapLabel(r.mapName, locale) }}</td>
                <td class="muted">{{ r.version || '-' }}</td>
                <td class="muted">{{ fmtTime(r.battleTime) || '-' }}</td>
                <td class="muted">{{ fmtTime(r.createdAt) }}</td>
                <td class="muted hash">{{ r.replayHash ? r.replayHash.slice(0, 12) + '…' : '-' }}</td>
                <td class="muted">{{ r.replaySize != null ? r.replaySize.toLocaleString() : '-' }}</td>
                <td class="muted">{{ r.replayUploadedBy || '-' }}</td>
                <td>{{ r.replayAvailable ? '✓' : '—' }}</td>
                <td class="actions">
                  <button v-if="r.replayAvailable" class="btn-sm" :title="$t('hofAdmin.download')" @click="download(r.id)">⬇</button>
                  <button class="btn-sm danger" :title="$t('hofAdmin.delete')" @click="askDelete(r)">🗑</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="totalPages > 1" class="pagination">
          <button :disabled="page <= 1" @click="goPage(page - 1)">{{ $t('hofAdmin.prev') }}</button>
          <span>{{ $t('hofAdmin.pageInfo', { page, total: totalPages, items: totalItems }) }}</span>
          <button :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t('hofAdmin.next') }}</button>
        </div>
        <label class="page-size">{{ $t('hofAdmin.size') }}
          <select v-model.number="size" @change="onSizeChange">
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>
      </div>

      <!-- ── 操作日志（只读）── -->
      <div v-else-if="activeTab === 'audit'">
        <p v-if="auditLoading" class="muted">{{ $t('hofAdmin.loading') }}</p>
        <p v-else-if="!auditRows.length" class="muted">{{ $t('hofAdmin.auditEmpty') }}</p>
        <div v-else class="tablewrap">
          <table class="hof-admin-table">
            <thead>
              <tr>
                <th>{{ $t('hofAdmin.auditTime') }}</th>
                <th>{{ $t('hofAdmin.auditAction') }}</th>
                <th>{{ $t('hofAdmin.auditAdmin') }}</th>
                <th>Record ID</th>
                <th>Account ID</th>
                <th>{{ $t('hofAdmin.player') }}</th>
                <th>{{ $t('hofAdmin.tank') }}</th>
                <th>{{ $t('hofAdmin.damage') }}</th>
                <th>{{ $t('hofAdmin.battleType') }}</th>
                <th>{{ $t('hofAdmin.replayHash') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in auditRows" :key="a.id">
                <td class="muted">{{ fmtTime(a.createdAt) }}</td>
                <td><span class="audit-action">{{ a.action }}</span></td>
                <td class="muted">{{ a.adminUsername || a.adminKeycloakUserId }}</td>
                <td class="muted">{{ a.recordId }}</td>
                <td class="muted">{{ a.accountId }}</td>
                <td>{{ a.nickname }}</td>
                <td>{{ a.tankName }}</td>
                <td class="dmg">{{ a.damageDealt.toLocaleString() }}</td>
                <td>{{ battleTypeLabel(a.battleType) }}</td>
                <td class="muted hash">{{ a.replayHash ? a.replayHash.slice(0, 12) + '…' : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="auditTotalPages > 1" class="pagination">
          <button :disabled="auditPage <= 1" @click="auditPage--; loadAudit()">{{ $t('hofAdmin.prev') }}</button>
          <span>{{ $t('hofAdmin.pageInfo', { page: auditPage, total: auditTotalPages, items: auditTotalItems }) }}</span>
          <button :disabled="auditPage >= auditTotalPages" @click="auditPage++; loadAudit()">{{ $t('hofAdmin.next') }}</button>
        </div>
      </div>

      <!-- ── 百场审核 ── -->
      <div v-else-if="activeTab === 'hundred'" class="hof-hundred">
        <div class="hof-admin-filters">
          <select v-model="hundredNation" @change="onHundredVehicleFilterChange">
            <option value="">{{ $t('hundred.allNations') }}</option>
            <option v-for="nation in hundredNations" :key="nation" :value="nation">{{ vehicleEnumLabel(nation) }}</option>
          </select>
          <select v-model="hundredVehicleType" @change="onHundredVehicleFilterChange">
            <option value="">{{ $t('hundred.allVehicleTypes') }}</option>
            <option v-for="vehicleType in hundredVehicleTypes" :key="vehicleType" :value="vehicleType">{{ vehicleEnumLabel(vehicleType) }}</option>
          </select>
          <select v-model="hundredVehicleId" @change="onHundredVehicleChange">
            <option :value="null">{{ $t('hundred.allVehicles') }}</option>
            <option v-for="vehicle in filteredHundredAdminVehicles" :key="vehicle.id" :value="vehicle.id">{{ vehicle.name }}</option>
          </select>
          <select v-model="hundredStatus" @change="onHundredStatusChange">
            <option value="">{{ $t('hundredAdmin.statusAll') }}</option>
            <option value="PENDING">{{ $t('hundredAdmin.status.PENDING') }}</option>
            <option value="CURRENT">{{ $t('hundredAdmin.status.CURRENT') }}</option>
            <option value="REJECTED">{{ $t('hundredAdmin.status.REJECTED') }}</option>
            <option value="SUPERSEDED">{{ $t('hundredAdmin.status.SUPERSEDED') }}</option>
            <option value="CANCELLED">{{ $t('hundredAdmin.status.CANCELLED') }}</option>
            <option value="DELETED">{{ $t('hundredAdmin.status.DELETED') }}</option>
          </select>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="hundredLoading" class="muted">{{ $t('hundredAdmin.loading') }}</p>
        <p v-else-if="!hundredRows.length" class="muted">{{ $t('hundredAdmin.empty') }}</p>
        <div v-else class="tablewrap">
          <table class="hof-admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{{ $t('hundredAdmin.vehicle') }}</th>
                <th>{{ $t('hundredAdmin.nicknameSnapshot') }}</th>
                <th>{{ $t('hundredAdmin.gameId') }}</th>
                <th>{{ $t('hundredAdmin.certifiedDamage') }}</th>
                <th>{{ $t('hundredAdmin.certifiedBattles') }}</th>
                <th>{{ $t('hundredAdmin.verificationSourceLabel') }}</th>
                <th>{{ $t('hundredAdmin.statusLabel') }}</th>
                <th>{{ $t('hundredAdmin.submittedAt') }}</th>
                <th>{{ $t('hofAdmin.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in hundredRows" :key="r.id">
                <td class="muted">{{ r.id }}</td>
                <td>{{ r.vehicleName }}</td>
                <td>{{ r.nicknameSnapshot }}</td>
                <td class="muted">{{ r.gameAccountIdSnapshot }}</td>
                <td class="dmg">{{ r.certifiedAverageDamage ?? '-' }}</td>
                <td>{{ r.certifiedBattleCount ?? '-' }}</td>
                <td><span class="hundred-source" :class="'hundred-source-' + (r.verificationSource || 'MANUAL').toLowerCase()">{{ verificationSourceLabel(r.verificationSource) }}</span></td>
                <td><span class="hundred-status" :class="'hundred-status-' + String(r.status).toLowerCase()">{{ hundredStatusLabel(r.status) }}</span></td>
                <td class="muted">{{ fmtTime(r.submittedAt) || '-' }}</td>
                <td class="actions">
                  <button class="btn-sm" @click="openReview(r)">{{ $t('hundredAdmin.details') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="hundredTotalPages > 1" class="pagination">
          <button :disabled="hundredPage <= 1" @click="goHundredPage(hundredPage - 1)">{{ $t('hundredAdmin.prev') }}</button>
          <span>{{ $t('hundredAdmin.pageInfo', { page: hundredPage, total: hundredTotalPages, items: hundredTotalItems }) }}</span>
          <button :disabled="hundredPage >= hundredTotalPages" @click="goHundredPage(hundredPage + 1)">{{ $t('hundredAdmin.next') }}</button>
        </div>
        <label class="page-size">{{ $t('hundredAdmin.size') }}
          <select v-model.number="size" @change="onSizeChange">
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>
      </div>

      <!-- ── 三环审核 ── -->
      <div v-else class="hof-mark3">
        <div class="hof-admin-filters">
          <select v-model="mark3Nation" @change="onMark3VehicleFilterChange">
            <option value="">{{ $t('mark3.allNations') }}</option>
            <option v-for="nation in mark3Nations" :key="nation" :value="nation">{{ vehicleEnumLabel(nation) }}</option>
          </select>
          <select v-model="mark3VehicleType" @change="onMark3VehicleFilterChange">
            <option value="">{{ $t('mark3.allVehicleTypes') }}</option>
            <option v-for="vehicleType in mark3VehicleTypes" :key="vehicleType" :value="vehicleType">{{ vehicleEnumLabel(vehicleType) }}</option>
          </select>
          <select v-model="mark3VehicleId" @change="onMark3VehicleChange">
            <option :value="null">{{ $t('mark3.allVehicles') }}</option>
            <option v-for="vehicle in filteredMark3AdminVehicles" :key="vehicle.id" :value="vehicle.id">{{ vehicle.name }}</option>
          </select>
          <select v-model="mark3Status" @change="onMark3StatusChange">
            <option value="">{{ $t('mark3Admin.statusAll') }}</option>
            <option value="PENDING">{{ $t('mark3Admin.status.PENDING') }}</option>
            <option value="CURRENT">{{ $t('mark3Admin.status.CURRENT') }}</option>
            <option value="REJECTED">{{ $t('mark3Admin.status.REJECTED') }}</option>
            <option value="CANCELLED">{{ $t('mark3Admin.status.CANCELLED') }}</option>
            <option value="DELETED">{{ $t('mark3Admin.status.DELETED') }}</option>
          </select>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="mark3Loading" class="muted">{{ $t('mark3Admin.loading') }}</p>
        <p v-else-if="!mark3Rows.length" class="muted">{{ $t('mark3Admin.empty') }}</p>
        <div v-else class="tablewrap">
          <table class="hof-admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{{ $t('mark3Admin.vehicle') }}</th>
                <th>{{ $t('mark3Admin.nicknameSnapshot') }}</th>
                <th>{{ $t('mark3Admin.gameId') }}</th>
                <th>{{ $t('mark3Admin.claimedBattles') }}</th>
                <th>{{ $t('mark3Admin.claimedDamage') }}</th>
                <th>{{ $t('mark3Admin.claimedWinRate') }}</th>
                <th>{{ $t('mark3Admin.statusLabel') }}</th>
                <th>{{ $t('mark3Admin.submittedAt') }}</th>
                <th>{{ $t('hofAdmin.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in mark3Rows" :key="row.id">
                <td class="muted">{{ row.id }}</td>
                <td>{{ row.vehicleName }}</td>
                <td>{{ row.nicknameSnapshot }}</td>
                <td class="muted">{{ row.gameAccountIdSnapshot }}</td>
                <td class="dmg">{{ formatNumber(row.claimedBattleCount) }}</td>
                <td>{{ formatNumber(row.claimedAverageDamage) }}</td>
                <td>{{ formatMark3WinRate(row.claimedWinRate) }}</td>
                <td><span class="hundred-status" :class="'hundred-status-' + String(row.status).toLowerCase()">{{ mark3StatusLabel(row.status) }}</span></td>
                <td class="muted">{{ fmtTime(row.submittedAt) || '-' }}</td>
                <td class="actions"><button class="btn-sm" @click="openMark3Review(row)">{{ $t('mark3Admin.details') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="mark3TotalPages > 1" class="pagination">
          <button :disabled="mark3Page <= 1" @click="goMark3Page(mark3Page - 1)">{{ $t('mark3Admin.prev') }}</button>
          <span>{{ $t('mark3Admin.pageInfo', { page: mark3Page, total: mark3TotalPages, items: mark3TotalItems }) }}</span>
          <button :disabled="mark3Page >= mark3TotalPages" @click="goMark3Page(mark3Page + 1)">{{ $t('mark3Admin.next') }}</button>
        </div>
        <label class="page-size">{{ $t('mark3Admin.size') }}
          <select v-model.number="size" @change="onSizeChange">
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>
      </div>

      <!-- ── 百场详情：所有状态都从这里查看，操作不会直接出现在列表中 ── -->
      <div v-if="reviewTarget" class="modal-overlay" @click.self="closeReview">
        <div class="modal hof-review-modal">
          <h3>{{ $t('hundredAdmin.details') }}</h3>
          <p v-if="reviewLoading" class="muted">{{ $t('hundredAdmin.loading') }}</p>
          <template v-else-if="reviewDetail">
            <table class="hof-delete-table">
              <tbody>
                <tr><th>{{ $t('hundredAdmin.user') }}</th><td>{{ reviewDetail.nicknameSnapshot }}</td></tr>
                <tr><th>{{ $t('hundredAdmin.gameId') }}</th><td class="muted">{{ reviewDetail.gameAccountIdSnapshot }}</td></tr>
                <tr><th>{{ $t('hundredAdmin.vehicle') }}</th><td>{{ reviewDetail.vehicleName }}</td></tr>
                <tr><th>{{ $t('hundredAdmin.claimedDamage') }}</th><td class="dmg">{{ reviewDetail.claimedAverageDamage }}</td></tr>
                <tr><th>{{ $t('hundredAdmin.claimedBattles') }}</th><td>{{ reviewDetail.claimedBattleCount }}</td></tr>
                <tr><th>{{ $t('hundredAdmin.verificationSourceLabel') }}</th><td><span class="hundred-source" :class="'hundred-source-' + (reviewDetail.verificationSource || 'MANUAL').toLowerCase()">{{ verificationSourceLabel(reviewDetail.verificationSource) }}</span></td></tr>
                <tr><th>{{ $t('hundredAdmin.statusLabel') }}</th><td>{{ hundredStatusLabel(reviewDetail.status) }}</td></tr>
                <tr><th>{{ $t('hundredAdmin.submittedAt') }}</th><td>{{ fmtTime(reviewDetail.submittedAt) || '-' }}</td></tr>
                <template v-if="reviewDetail.approvedAverageDamage != null">
                  <tr><th>{{ $t('hundredAdmin.approvedDamage') }}</th><td class="dmg">{{ reviewDetail.approvedAverageDamage }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.approvedBattles') }}</th><td>{{ reviewDetail.approvedBattleCount }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.approvedAt') }}</th><td>{{ fmtTime(reviewDetail.approvedAt) || '-' }}</td></tr>
                </template>
                <template v-if="reviewDetail.status === 'REJECTED'">
                  <tr><th>{{ $t('hundredAdmin.rejectReason') }}</th><td>{{ reasonLabel('reject', reviewDetail.rejectReason) }}</td></tr>
                  <tr v-if="reviewDetail.rejectReasonText"><th>{{ $t('hundredAdmin.rejectReasonTextValue') }}</th><td>{{ reviewDetail.rejectReasonText }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.rejectedAt') }}</th><td>{{ fmtTime(reviewDetail.rejectedAt) || '-' }}</td></tr>
                </template>
                <template v-if="reviewDetail.status === 'CANCELLED'">
                  <tr><th>{{ $t('hundredAdmin.cancelledAt') }}</th><td>{{ fmtTime(reviewDetail.cancelledAt) || '-' }}</td></tr>
                </template>
                <template v-if="reviewDetail.status === 'DELETED'">
                  <tr><th>{{ $t('hundredAdmin.deleteReason') }}</th><td>{{ reasonLabel('delete', reviewDetail.deleteReason) }}</td></tr>
                  <tr v-if="reviewDetail.deleteReasonText"><th>{{ $t('hundredAdmin.deleteReasonTextValue') }}</th><td>{{ reviewDetail.deleteReasonText }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.deletedAt') }}</th><td>{{ fmtTime(reviewDetail.deletedAt) || '-' }}</td></tr>
                </template>
              </tbody>
            </table>

            <div v-if="isWargamingReview" class="hundred-review-section hundred-wg-snapshot">
              <div class="hundred-review-label">{{ $t('hundredAdmin.wgSnapshot') }}</div>
              <table class="hof-delete-table">
                <tbody>
                  <tr><th>{{ $t('hundredAdmin.verifiedServer') }}</th><td>{{ verifiedServerLabel(reviewDetail.verifiedServer) }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.verifiedAccountId') }}</th><td class="muted">{{ reviewDetail.gameAccountIdSnapshot }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.officialAccountBattles') }}</th><td>{{ formatNumber(reviewDetail.officialAccountBattleCount) }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.officialTankBattles') }}</th><td>{{ formatNumber(reviewDetail.officialTankBattleCount) }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.officialTankDamage') }}</th><td>{{ formatNumber(reviewDetail.officialTankDamageDealt) }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.officialAverageDamage') }}</th><td class="dmg">{{ formatNumber(reviewDetail.officialAverageDamage) }}</td></tr>
                  <tr><th>{{ $t('hundredAdmin.verifiedAt') }}</th><td>{{ fmtTime(reviewDetail.verifiedAt) || '-' }}</td></tr>
                </tbody>
              </table>
            </div>

            <div v-if="reviewDetail.status === 'PENDING' && !isWargamingReview" class="hundred-review-section">
              <div class="hundred-review-label">{{ $t('hundredAdmin.evidence') }}</div>
              <div class="hundred-proof-row">
                <img v-if="reviewDetail.proofScreenshot" class="hundred-proof" :src="reviewDetail.proofScreenshot"
                     :alt="$t('hundredAdmin.screenshot')" @click="screenshotZoom = true" />
                <span v-else class="hundred-proof-empty">—</span>
                <button v-if="reviewDetail.proofScreenshot" class="btn-sm" @click="downloadScreenshot">
                  {{ $t('hundredAdmin.downloadScreenshot') }}
                </button>
              </div>
              <p v-if="evidenceLoading" class="muted">{{ $t('hundredAdmin.loading') }}</p>
              <p v-else-if="evidenceError" class="error">{{ evidenceError }}</p>
              <template v-else>
                <p v-if="!replayEvidence.length" class="hundred-legacy-warn">
                  {{ $t('hundredAdmin.legacyNoReplays') }}
                </p>
                <template v-else>
                  <p v-if="replayEvidence.length !== 5" class="hundred-legacy-warn">
                    {{ $t('hundredAdmin.evidenceIncomplete') }}
                  </p>
                  <ul class="replay-evidence-list">
                    <li v-for="ev in replayEvidence" :key="ev.id" class="replay-evidence-item">
                      <span class="replay-slot">#{{ ev.slot }}</span>
                      <span class="replay-name" :title="ev.originalFilename">{{ ev.originalFilename }}</span>
                      <span class="replay-size">{{ fmtSize(ev.fileSize) }}</span>
                      <button class="btn-sm" :title="$t('hundredAdmin.replayDownload')" @click="downloadReplay(ev)">⬇</button>
                    </li>
                  </ul>
                </template>
              </template>
            </div>

            <div v-if="!isWargamingReview" class="hundred-review-section">
              <div class="hundred-review-label">{{ $t('hundredAdmin.replayValidation') }}</div>
              <ul class="val-list">
                <li :class="reviewDetail.replayParseOk ? 'val-ok' : 'val-bad'">
                  <span class="val-mark">{{ reviewDetail.replayParseOk ? '✓' : '✗' }}</span>{{ $t('hundredAdmin.valParsed') }}
                </li>
                <li :class="reviewDetail.replayGameIdMatch ? 'val-ok' : 'val-bad'">
                  <span class="val-mark">{{ reviewDetail.replayGameIdMatch ? '✓' : '✗' }}</span>{{ $t('hundredAdmin.valGameId') }}
                </li>
                <li :class="reviewDetail.replayVehicleMatch ? 'val-ok' : 'val-bad'">
                  <span class="val-mark">{{ reviewDetail.replayVehicleMatch ? '✓' : '✗' }}</span>{{ $t('hundredAdmin.valVehicle') }}
                </li>
                <li :class="reviewDetail.replayDistinctBattles ? 'val-ok' : 'val-bad'">
                  <span class="val-mark">{{ reviewDetail.replayDistinctBattles ? '✓' : '✗' }}</span>{{ $t('hundredAdmin.valDistinct') }}
                </li>
              </ul>
            </div>

            <p v-if="actionMsg" class="error">{{ actionMsg }}</p>

            <div v-if="reviewDetail.status === 'PENDING' && reviewPhase === 'view'" class="modal-actions">
              <button class="btn-sm" :disabled="actionBusy" @click="closeReview">{{ $t('hundredAdmin.close') }}</button>
              <button class="btn-sm danger" :disabled="actionBusy" @click="askReject">{{ $t('hundredAdmin.reject') }}</button>
              <button class="btn-sm ok" :disabled="actionBusy || !evidenceComplete" :title="evidenceComplete ? '' : approveDisabledHint" @click="askApprove">{{ $t('hundredAdmin.approve') }}</button>
            </div>

            <div v-else-if="reviewDetail.status === 'PENDING' && reviewPhase === 'approve-confirm'" class="hundred-action-area">
              <p class="hundred-confirm">{{ $t('hundredAdmin.approveConfirm') }}</p>
              <div class="modal-actions">
                <button class="btn-sm" :disabled="actionBusy" @click="reviewPhase = 'view'">{{ $t('hundredAdmin.cancel') }}</button>
                <button class="btn-sm ok" :disabled="actionBusy" @click="confirmApprove">
                  {{ actionBusy ? $t('hundredAdmin.approving') : $t('hundredAdmin.approve') }}
                </button>
              </div>
            </div>

            <div v-else-if="reviewDetail.status === 'PENDING' && reviewPhase === 'reject-form'" class="hundred-action-area">
              <label class="hundred-reason-label">{{ $t('hundredAdmin.rejectReason') }}</label>
              <select v-model="rejectReason">
                <option value="">{{ $t('hundredAdmin.rejectReasonRequired') }}</option>
                <option v-for="(label, key) in $tm('hundredAdmin.rejectReasonOptions')" :key="key" :value="key">{{ label }}</option>
              </select>
              <textarea v-model="rejectReasonText" rows="2" :placeholder="$t('hundredAdmin.rejectReasonPlaceholder')"></textarea>
              <p class="hundred-confirm">{{ $t('hundredAdmin.rejectConfirm') }}</p>
              <div class="modal-actions">
                <button class="btn-sm" :disabled="actionBusy" @click="reviewPhase = 'view'">{{ $t('hundredAdmin.cancel') }}</button>
                <button class="btn-sm danger" :disabled="actionBusy" @click="confirmReject">
                  {{ actionBusy ? $t('hundredAdmin.rejecting') : $t('hundredAdmin.reject') }}
                </button>
              </div>
            </div>

            <div v-else-if="reviewDetail.status === 'CURRENT' && reviewPhase === 'view'" class="modal-actions">
              <button class="btn-sm" :disabled="actionBusy" @click="closeReview">{{ $t('hundredAdmin.close') }}</button>
              <button class="btn-sm danger" :disabled="actionBusy" @click="askCurrentDelete">{{ $t('hundredAdmin.delete') }}</button>
            </div>

            <div v-else-if="reviewDetail.status === 'CURRENT' && reviewPhase === 'delete-form'" class="hundred-action-area">
              <label class="hundred-reason-label">{{ $t('hundredAdmin.deleteReason') }}</label>
              <select v-model="currentDeleteReason">
                <option value="">{{ $t('hundredAdmin.deleteReasonRequired') }}</option>
                <option v-for="(label, key) in $tm('hundredAdmin.deleteReasonOptions')" :key="key" :value="key">{{ label }}</option>
              </select>
              <textarea v-model="currentDeleteReasonText" rows="2" :placeholder="$t('hundredAdmin.deleteReasonPlaceholder')"></textarea>
              <p class="hundred-confirm">{{ $t('hundredAdmin.deleteConfirm') }}</p>
              <div class="modal-actions">
                <button class="btn-sm" :disabled="actionBusy" @click="cancelCurrentDelete">{{ $t('hundredAdmin.cancel') }}</button>
                <button class="btn-sm danger" :disabled="actionBusy" @click="confirmCurrentDelete">
                  {{ actionBusy ? $t('hundredAdmin.deleting') : $t('hundredAdmin.delete') }}
                </button>
              </div>
            </div>

            <div v-else class="modal-actions">
              <button class="btn-sm" :disabled="actionBusy" @click="closeReview">{{ $t('hundredAdmin.close') }}</button>
            </div>
          </template>
        </div>
      </div>

      <!-- ── 三环详情：只审核状态，绝不提供成绩编辑控件 ── -->
      <div v-if="mark3ReviewTarget" class="modal-overlay" @click.self="closeMark3Review">
        <div class="modal hof-review-modal">
          <h3>{{ $t('mark3Admin.details') }}</h3>
          <p v-if="mark3ReviewLoading" class="muted">{{ $t('mark3Admin.loading') }}</p>
          <template v-else-if="mark3ReviewDetail">
            <table class="hof-delete-table">
              <tbody>
                <tr><th>{{ $t('mark3Admin.user') }}</th><td>{{ mark3ReviewDetail.nicknameSnapshot }}</td></tr>
                <tr><th>{{ $t('mark3Admin.gameId') }}</th><td class="muted">{{ mark3ReviewDetail.gameAccountIdSnapshot }}</td></tr>
                <tr><th>{{ $t('mark3Admin.vehicle') }}</th><td>{{ mark3ReviewDetail.vehicleName }}</td></tr>
                <tr><th>{{ $t('mark3Admin.claimedBattles') }}</th><td class="dmg">{{ formatNumber(mark3ReviewDetail.claimedBattleCount) }}</td></tr>
                <tr><th>{{ $t('mark3Admin.claimedDamage') }}</th><td>{{ formatNumber(mark3ReviewDetail.claimedAverageDamage) }}</td></tr>
                <tr><th>{{ $t('mark3Admin.claimedWinRate') }}</th><td>{{ formatMark3WinRate(mark3ReviewDetail.claimedWinRate) }}</td></tr>
                <tr><th>{{ $t('mark3Admin.statusLabel') }}</th><td>{{ mark3StatusLabel(mark3ReviewDetail.status) }}</td></tr>
                <tr><th>{{ $t('mark3Admin.submittedAt') }}</th><td>{{ fmtTime(mark3ReviewDetail.submittedAt) || '-' }}</td></tr>
                <template v-if="mark3ReviewDetail.approvedBattleCount != null">
                  <tr><th>{{ $t('mark3Admin.approvedBattles') }}</th><td class="dmg">{{ formatNumber(mark3ReviewDetail.approvedBattleCount) }}</td></tr>
                  <tr><th>{{ $t('mark3Admin.approvedDamage') }}</th><td>{{ formatNumber(mark3ReviewDetail.approvedAverageDamage) }}</td></tr>
                  <tr><th>{{ $t('mark3Admin.approvedWinRate') }}</th><td>{{ formatMark3WinRate(mark3ReviewDetail.approvedWinRate) }}</td></tr>
                  <tr><th>{{ $t('mark3Admin.approvedAt') }}</th><td>{{ fmtTime(mark3ReviewDetail.approvedAt) || '-' }}</td></tr>
                </template>
                <template v-if="mark3ReviewDetail.status === 'REJECTED'">
                  <tr><th>{{ $t('mark3Admin.rejectReason') }}</th><td>{{ mark3ReasonLabel('reject', mark3ReviewDetail.rejectReason) }}</td></tr>
                  <tr v-if="mark3ReviewDetail.rejectReasonText"><th>{{ $t('mark3Admin.rejectReasonTextValue') }}</th><td>{{ mark3ReviewDetail.rejectReasonText }}</td></tr>
                  <tr><th>{{ $t('mark3Admin.rejectedAt') }}</th><td>{{ fmtTime(mark3ReviewDetail.rejectedAt) || '-' }}</td></tr>
                </template>
                <template v-if="mark3ReviewDetail.status === 'CANCELLED'">
                  <tr><th>{{ $t('mark3Admin.cancelledAt') }}</th><td>{{ fmtTime(mark3ReviewDetail.cancelledAt) || '-' }}</td></tr>
                </template>
                <template v-if="mark3ReviewDetail.status === 'DELETED'">
                  <tr><th>{{ $t('mark3Admin.deleteReason') }}</th><td>{{ mark3ReasonLabel('delete', mark3ReviewDetail.deleteReason) }}</td></tr>
                  <tr v-if="mark3ReviewDetail.deleteReasonText"><th>{{ $t('mark3Admin.deleteReasonTextValue') }}</th><td>{{ mark3ReviewDetail.deleteReasonText }}</td></tr>
                  <tr><th>{{ $t('mark3Admin.deletedAt') }}</th><td>{{ fmtTime(mark3ReviewDetail.deletedAt) || '-' }}</td></tr>
                </template>
              </tbody>
            </table>

            <div v-if="mark3ReviewDetail.status === 'PENDING'" class="hundred-review-section">
              <div class="hundred-review-label">{{ $t('mark3Admin.evidence') }}</div>
              <div v-if="mark3ReviewDetail.proofScreenshots?.length" class="mark3-admin-screenshots">
                <div v-for="(screenshot, index) in mark3ReviewDetail.proofScreenshots" :key="screenshot" class="hundred-proof-row">
                  <img class="hundred-proof" :src="screenshot" :alt="$t('mark3Admin.screenshot', { number: index + 1 })" @click="mark3ScreenshotZoom = screenshot" />
                  <button class="btn-sm" @click="downloadMark3Screenshot(screenshot, index)">{{ $t('mark3Admin.downloadScreenshot') }}</button>
                </div>
              </div>
              <span v-else class="hundred-proof-empty">—</span>
              <p v-if="mark3EvidenceLoading" class="muted">{{ $t('mark3Admin.loading') }}</p>
              <p v-else-if="mark3EvidenceError" class="error">{{ mark3EvidenceError }}</p>
              <template v-else>
                <p v-if="!mark3ReplayEvidence.length" class="hundred-legacy-warn">{{ $t('mark3Admin.legacyNoReplays') }}</p>
                <template v-else>
                  <p v-if="mark3ReplayEvidence.length !== 5" class="hundred-legacy-warn">{{ $t('mark3Admin.evidenceIncomplete') }}</p>
                  <ul class="replay-evidence-list">
                    <li v-for="evidence in mark3ReplayEvidence" :key="evidence.id" class="replay-evidence-item">
                      <span class="replay-slot">#{{ evidence.slot }}</span>
                      <span class="replay-name" :title="evidence.originalFilename">{{ evidence.originalFilename }}</span>
                      <span class="replay-size">{{ fmtSize(evidence.fileSize) }}</span>
                      <button class="btn-sm" :title="$t('mark3Admin.replayDownload')" @click="downloadMark3Replay(evidence)">⬇</button>
                    </li>
                  </ul>
                </template>
              </template>
            </div>

            <div class="hundred-review-section">
              <div class="hundred-review-label">{{ $t('mark3Admin.replayValidation') }}</div>
              <ul class="val-list">
                <li :class="mark3ReviewDetail.replayParseOk ? 'val-ok' : 'val-bad'"><span class="val-mark">{{ mark3ReviewDetail.replayParseOk ? '✓' : '✗' }}</span>{{ $t('mark3Admin.valParsed') }}</li>
                <li :class="mark3ReviewDetail.replayGameIdMatch ? 'val-ok' : 'val-bad'"><span class="val-mark">{{ mark3ReviewDetail.replayGameIdMatch ? '✓' : '✗' }}</span>{{ $t('mark3Admin.valGameId') }}</li>
                <li :class="mark3ReviewDetail.replayVehicleMatch ? 'val-ok' : 'val-bad'"><span class="val-mark">{{ mark3ReviewDetail.replayVehicleMatch ? '✓' : '✗' }}</span>{{ $t('mark3Admin.valVehicle') }}</li>
                <li :class="mark3ReviewDetail.replayDistinctBattles ? 'val-ok' : 'val-bad'"><span class="val-mark">{{ mark3ReviewDetail.replayDistinctBattles ? '✓' : '✗' }}</span>{{ $t('mark3Admin.valDistinct') }}</li>
              </ul>
            </div>

            <p v-if="mark3ActionMsg" class="error">{{ mark3ActionMsg }}</p>

            <div v-if="mark3ReviewDetail.status === 'PENDING' && mark3ReviewPhase === 'view'" class="modal-actions">
              <button class="btn-sm" :disabled="mark3ActionBusy" @click="closeMark3Review">{{ $t('mark3Admin.close') }}</button>
              <button class="btn-sm danger" :disabled="mark3ActionBusy" @click="askMark3Reject">{{ $t('mark3Admin.reject') }}</button>
              <button class="btn-sm ok" :disabled="mark3ActionBusy || !mark3EvidenceComplete" :title="mark3EvidenceComplete ? '' : $t('mark3Admin.approveDisabledHint')" @click="askMark3Approve">{{ $t('mark3Admin.approve') }}</button>
            </div>

            <div v-else-if="mark3ReviewDetail.status === 'PENDING' && mark3ReviewPhase === 'approve-confirm'" class="hundred-action-area">
              <p class="hundred-confirm">{{ $t('mark3Admin.approveConfirm') }}</p>
              <div class="modal-actions">
                <button class="btn-sm" :disabled="mark3ActionBusy" @click="mark3ReviewPhase = 'view'">{{ $t('mark3Admin.cancel') }}</button>
                <button class="btn-sm ok" :disabled="mark3ActionBusy" @click="confirmMark3Approve">{{ mark3ActionBusy ? $t('mark3Admin.approving') : $t('mark3Admin.approve') }}</button>
              </div>
            </div>

            <div v-else-if="mark3ReviewDetail.status === 'PENDING' && mark3ReviewPhase === 'reject-form'" class="hundred-action-area">
              <label class="hundred-reason-label">{{ $t('mark3Admin.rejectReason') }}</label>
              <select v-model="mark3RejectReason">
                <option value="">{{ $t('mark3Admin.rejectReasonRequired') }}</option>
                <option v-for="(label, key) in $tm('mark3Admin.rejectReasonOptions')" :key="key" :value="key">{{ label }}</option>
              </select>
              <textarea v-model="mark3RejectReasonText" rows="2" maxlength="500" :placeholder="$t('mark3Admin.rejectReasonPlaceholder')"></textarea>
              <p class="hundred-confirm">{{ $t('mark3Admin.rejectConfirm') }}</p>
              <div class="modal-actions">
                <button class="btn-sm" :disabled="mark3ActionBusy" @click="mark3ReviewPhase = 'view'">{{ $t('mark3Admin.cancel') }}</button>
                <button class="btn-sm danger" :disabled="mark3ActionBusy" @click="confirmMark3Reject">{{ mark3ActionBusy ? $t('mark3Admin.rejecting') : $t('mark3Admin.reject') }}</button>
              </div>
            </div>

            <div v-else-if="mark3ReviewDetail.status === 'CURRENT' && mark3ReviewPhase === 'view'" class="modal-actions">
              <button class="btn-sm" :disabled="mark3ActionBusy" @click="closeMark3Review">{{ $t('mark3Admin.close') }}</button>
              <button class="btn-sm danger" :disabled="mark3ActionBusy" @click="askMark3Delete">{{ $t('mark3Admin.delete') }}</button>
            </div>

            <div v-else-if="mark3ReviewDetail.status === 'CURRENT' && mark3ReviewPhase === 'delete-form'" class="hundred-action-area">
              <label class="hundred-reason-label">{{ $t('mark3Admin.deleteReason') }}</label>
              <select v-model="mark3DeleteReason">
                <option value="">{{ $t('mark3Admin.deleteReasonRequired') }}</option>
                <option v-for="(label, key) in $tm('mark3Admin.deleteReasonOptions')" :key="key" :value="key">{{ label }}</option>
              </select>
              <textarea v-model="mark3DeleteReasonText" rows="2" maxlength="500" :placeholder="$t('mark3Admin.deleteReasonPlaceholder')"></textarea>
              <p class="hundred-confirm">{{ $t('mark3Admin.deleteConfirm') }}</p>
              <div class="modal-actions">
                <button class="btn-sm" :disabled="mark3ActionBusy" @click="mark3ReviewPhase = 'view'">{{ $t('mark3Admin.cancel') }}</button>
                <button class="btn-sm danger" :disabled="mark3ActionBusy" @click="confirmMark3Delete">{{ mark3ActionBusy ? $t('mark3Admin.deleting') : $t('mark3Admin.delete') }}</button>
              </div>
            </div>

            <div v-else class="modal-actions">
              <button class="btn-sm" :disabled="mark3ActionBusy" @click="closeMark3Review">{{ $t('mark3Admin.close') }}</button>
            </div>
          </template>
        </div>
      </div>

      <!-- ── 截图放大（lightbox）── -->
      <div v-if="screenshotZoom && reviewDetail?.proofScreenshot" class="modal-overlay screenshot-zoom" @click.self="screenshotZoom = false">
        <div class="screenshot-zoom-inner">
          <img :src="reviewDetail.proofScreenshot" :alt="$t('hundredAdmin.screenshot')" />
          <button class="btn-sm" @click="screenshotZoom = false">{{ $t('hundredAdmin.zoomClose') }}</button>
        </div>
      </div>
      <div v-if="mark3ScreenshotZoom" class="modal-overlay screenshot-zoom" @click.self="mark3ScreenshotZoom = ''">
        <div class="screenshot-zoom-inner">
          <img :src="mark3ScreenshotZoom" :alt="$t('mark3Admin.screenshot', { number: '' })" />
          <button class="btn-sm" @click="mark3ScreenshotZoom = ''">{{ $t('mark3Admin.zoomClose') }}</button>
        </div>
      </div>

      <!-- ── 删除二次确认 ── -->
      <div v-if="deleteTarget" class="modal-overlay" @click.self="cancelDelete">
        <div class="modal hof-delete-modal">
          <h3>{{ $t('hofAdmin.deleteTitle') }}</h3>
          <p class="hof-delete-msg">{{ $t('hofAdmin.deleteHint') }}</p>
          <table class="hof-delete-table">
            <tbody>
              <tr><th>{{ $t('hofAdmin.player') }}</th><td>{{ deleteTarget.nickname }}</td></tr>
              <tr><th>{{ $t('hofAdmin.tank') }}</th><td>{{ deleteTarget.tankName }}</td></tr>
              <tr><th>{{ $t('hofAdmin.damage') }}</th><td>{{ deleteTarget.damageDealt.toLocaleString() }}</td></tr>
              <tr><th>{{ $t('hofAdmin.battleType') }}</th><td>{{ battleTypeLabel(deleteTarget.battleType) }}</td></tr>
              <tr><th>{{ $t('hofAdmin.map') }}</th><td>{{ mapLabel(deleteTarget.mapName, locale) }}</td></tr>
              <tr><th>{{ $t('hofAdmin.battleTime') }}</th><td>{{ fmtTime(deleteTarget.battleTime) || '-' }}</td></tr>
            </tbody>
          </table>
          <p v-if="deleteMsg" class="error">{{ deleteMsg }}</p>
          <div class="modal-actions">
            <button class="btn-sm" :disabled="deleting" @click="cancelDelete">{{ $t('hofAdmin.cancel') }}</button>
            <button class="btn-sm danger" :disabled="deleting" @click="confirmDelete">
              {{ deleting ? $t('hofAdmin.deleting') : $t('hofAdmin.delete') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hof-admin { max-width: 1280px; margin: 0 auto; padding: 24px 20px 56px; }
.hof-admin-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.hof-admin-tabs button { padding: 8px 16px; border: 1px solid var(--border-ghost); border-radius: 8px;
  background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-family: inherit; font-size: .9rem; }
.hof-admin-tabs button.active { background: var(--bg-blue); color: var(--accent-dark); border-color: var(--border-tab-active); font-weight: 700; }
.hof-admin-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.hof-admin-filters input, .hof-admin-filters select {
  border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label);
  padding: 6px 10px; border-radius: 7px; font-size: 13px; font-family: inherit; }
.hof-admin-table { font-size: .8rem; }
.hof-admin-table th { white-space: nowrap; padding: 6px 8px; }
.hof-admin-table td { padding: 6px 8px; }
.hof-admin-table .dmg { font-weight: 700; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.hof-admin-table .muted { color: var(--text-muted); }
.hof-admin-table .hash { font-family: monospace; font-size: .75rem; }
.hof-admin-table .actions { white-space: nowrap; }
.bt-badge { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.bt-random { background: var(--rating-good-bg); color: var(--rating-good-fg); }
.bt-rating { background: var(--rating-great-bg); color: var(--rating-great-fg); }
.audit-action { display: inline-block; padding: 1px 7px; border-radius: 6px; background: var(--status-warn-bg); color: var(--status-warn-fg); font-size: 11px; font-weight: 600; }
.hundred-status { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.hundred-status-pending { background: var(--status-warn-bg); color: var(--status-warn-fg); }
.hundred-status-current { background: var(--rating-good-bg); color: var(--rating-good-fg); }
.hundred-status-rejected, .hundred-status-deleted { background: color-mix(in srgb, var(--error) 12%, var(--bg-card2)); color: var(--error); }
.hundred-status-superseded, .hundred-status-cancelled { background: var(--bg-chip); color: var(--text-muted); }
.hundred-source { display: inline-block; padding: 1px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.hundred-source-manual { background: var(--bg-chip); color: var(--text-label); }
.hundred-source-wargaming_api { background: var(--rating-good-bg); color: var(--rating-good-fg); }
.btn-sm { padding: 5px 12px; border: 1px solid var(--border-ghost); border-radius: 7px; background: var(--bg-card2);
  color: var(--text-label); cursor: pointer; font-family: inherit; font-size: .8rem; }
.btn-sm.danger { color: var(--delete); border-color: color-mix(in srgb, var(--delete) 45%, var(--border-ghost)); }
.btn-sm.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--delete) 8%, var(--bg-card2)); }
.btn-sm.ok { color: var(--rating-good-fg); border-color: color-mix(in srgb, var(--rating-good-fg) 45%, var(--border-ghost)); }
.btn-sm.ok:hover:not(:disabled) { background: color-mix(in srgb, var(--rating-good-fg) 8%, var(--bg-card2)); }
.btn-sm:disabled { opacity: .5; cursor: not-allowed; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 14px 0; font-size: .82rem; }
.pagination button { padding: 5px 12px; border: 1px solid var(--border-ghost); border-radius: 7px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-family: inherit; }
.pagination button:disabled { opacity: .4; cursor: not-allowed; }
.page-size { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-label); margin-top: 8px; }
.page-size select { border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label); padding: 4px 8px; border-radius: 6px; font-family: inherit; }
.error { display: inline-block; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--error) 35%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--error) 8%, var(--bg-card)); color: var(--error); }
.muted { padding: 24px 4px; color: var(--text-muted); }
.hof-admin-denied { max-width: 520px; margin: 48px auto; text-align: center; }
.hof-admin-denied h2 { color: var(--text-heading); }
.hof-delete-table { width: 100%; font-size: .85rem; margin: 12px 0; }
.hof-delete-table th { text-align: left; padding: 6px 10px; color: var(--text-muted); font-weight: 600; width: 40%; }
.hof-delete-table td { padding: 6px 10px; }
.hof-delete-msg { color: var(--warn-text); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.hof-review-modal { max-width: 620px; }
.hundred-review-section { margin: 12px 0; }
.hundred-review-label { font-weight: 600; color: var(--text-muted); font-size: .85rem; margin-bottom: 6px; }
.hundred-wg-snapshot { padding: 10px; border: 1px solid var(--border-ghost); border-radius: 8px; background: var(--bg-card2); }
.hundred-wg-snapshot .hof-delete-table { margin: 4px 0 0; }
.hundred-proof { display: block; max-width: 100%; max-height: 320px; border: 1px solid var(--border-ghost); border-radius: 8px; cursor: zoom-in; }
.hundred-proof-empty { color: var(--text-muted); }
.hundred-proof-row { display: flex; align-items: flex-start; gap: 10px; }
.mark3-admin-screenshots { display: grid; gap: 10px; }
.hundred-proof-row .btn-sm { margin-top: 4px; white-space: nowrap; }
.replay-evidence-list { list-style: none; padding: 0; margin: 6px 0; }
.replay-evidence-item { display: flex; align-items: center; gap: 10px; padding: 4px 0; font-size: .85rem; color: var(--text-label); }
.replay-slot { color: var(--text-muted); font-weight: 600; min-width: 2.2em; }
.replay-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.replay-size { color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.hundred-legacy-warn { color: var(--warn-text); font-size: .85rem; margin: 6px 0; }
.screenshot-zoom .screenshot-zoom-inner { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.screenshot-zoom .screenshot-zoom-inner img { max-width: 90vw; max-height: 80vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
.val-list { list-style: none; padding: 0; margin: 6px 0; }
.val-list li { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: .85rem; color: var(--text-label); }
.val-mark { font-weight: 700; }
.val-ok { color: var(--rating-good-fg); }
.val-bad { color: var(--error); }
.hundred-action-area { margin-top: 12px; }
.hundred-action-area select, .hundred-action-area textarea {
  width: 100%; border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label);
  padding: 6px 10px; border-radius: 7px; font-size: 13px; font-family: inherit; margin: 4px 0 8px; }
.hundred-reason-label { display: block; font-size: .85rem; color: var(--text-muted); font-weight: 600; margin-top: 8px; }
.hundred-confirm { color: var(--warn-text); font-size: .85rem; margin: 8px 0; }
</style>
