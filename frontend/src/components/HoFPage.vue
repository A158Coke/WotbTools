<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel, formatDateTimeMinute, replayValueLabel } from '../utils/display.js'
import { HUNDRED_VEHICLES } from '../utils/hundredVehicles.js'
import * as api from '../utils/api.js'
import ImageDataUploader from './ImageDataUploader.vue'

const { locale, t, te } = useI18n()
const rows = ref([])
const loading = ref(false)
const error = ref('')
const limit = ref(50)
const page = ref(1)
const totalPages = ref(0)
const uploading = ref(false)
const uploadMsg = ref('')
const uploadOk = ref(false)
const dragging = ref(false)
const showUploadModal = ref(false)
const fileInput = ref(null)
const downloadingId = ref(null)
const downloadErr = ref('')

const { isAuthenticated, login } = useAuth()

function requireLogin() {
  if (isAuthenticated()) return true
  login('hof')
  return false
}

const battleType = ref('')
const selectedTankId = ref(null)
const selectedTankName = ref('')
const nickname = ref('')
const singleVehicleOptions = ref([])
const singleVehicleOptionsLoading = ref(false)
const singleVehicleOptionsError = ref('')
const singleNation = ref('')
const singleVehicleType = ref('')
const singleVehicleTier = ref('')
let loadGeneration = 0

const singleVehicleNations = computed(() => uniqueValues(singleVehicleOptions.value.map(vehicle => vehicle.nation)))
const singleVehicleTypes = computed(() => uniqueValues(singleVehicleOptions.value.map(vehicle => vehicle.type)))
const singleVehicleTiers = computed(() => uniqueValues(singleVehicleOptions.value
  .map(vehicle => vehicle.tier)
  .filter(tier => tier != null))
  .sort((a, b) => a - b))
const filteredSingleVehicles = computed(() => singleVehicleOptions.value
  .filter(vehicle => (!singleNation.value || vehicle.nation === singleNation.value)
    && (!singleVehicleType.value || vehicle.type === singleVehicleType.value)
    && (!singleVehicleTier.value || String(vehicle.tier) === singleVehicleTier.value))
  .sort((a, b) => (a.tankName || '').localeCompare(b.tankName || '')))

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  try {
    const params = {
      page: page.value,
      size: limit.value,
      battleType: battleType.value,
      tankId: selectedTankId.value,
      nation: singleNation.value,
      vehicleType: singleVehicleType.value,
      tier: singleVehicleTier.value,
      nickname: nickname.value.trim(),
    }
    const res = await api.hofList(params)
    if (generation !== loadGeneration) return
    rows.value = res.items || []
    totalPages.value = res.totalPages || 0
  } catch (e) {
    if (generation === loadGeneration) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function onBattleTypeChange() {
  page.value = 1
  load()
}

function filterByTank(tankId, tankName) {
  singleNation.value = ''
  singleVehicleType.value = ''
  singleVehicleTier.value = ''
  selectedTankId.value = tankId
  selectedTankName.value = tankName
  page.value = 1
  load()
}

async function loadSingleVehicleOptions() {
  singleVehicleOptionsLoading.value = true
  singleVehicleOptionsError.value = ''
  try {
    singleVehicleOptions.value = (await api.hofVehicleOptions()) || []
  } catch (e) {
    singleVehicleOptionsError.value = apiErrorLabel(t, te, e)
  } finally {
    singleVehicleOptionsLoading.value = false
  }
}

function onSingleVehicleConditionChange() {
  if (selectedTankId.value
      && !filteredSingleVehicles.value.some(vehicle => vehicle.tankId === Number(selectedTankId.value))) {
    selectedTankId.value = null
    selectedTankName.value = ''
  }
  page.value = 1
  load()
}

function onSingleVehicleChange() {
  const vehicle = singleVehicleOptions.value.find(option => option.tankId === Number(selectedTankId.value))
  selectedTankName.value = vehicle?.tankName || ''
  page.value = 1
  load()
}

function vehicleOptionLabel(vehicle) {
  const name = vehicle.tankName || t('hof.unknownVehicle')
  return vehicle.tier == null ? name : `${name} · T${vehicle.tier}`
}

function vehicleValueLabel(value) {
  return replayValueLabel(t, te, value)
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

function clearFilter() {
  selectedTankId.value = null
  selectedTankName.value = ''
  page.value = 1
  load()
}

function searchNickname() {
  page.value = 1
  load()
}

function goPage(p) {
  page.value = p
  load()
}

async function upload(file) {
  if (uploading.value) return
  if (!requireLogin()) return
  if (!file || !file.name.toLowerCase().endsWith('.wotbreplay')) {
    uploadMsg.value = t('hof.invalid_file')
    return
  }
  uploading.value = true
  uploadMsg.value = ''
  uploadOk.value = false
  try {
    const result = await api.hofUpload(file)
    if (result.status === 'skipped') {
      uploadMsg.value = t('hof.upload_skipped', {
        reason: result.reasonCode && te(`hof.reason.${result.reasonCode}`)
          ? t(`hof.reason.${result.reasonCode}`)
          : t('hof.upload_skipped_default'),
      })
    } else {
      uploadMsg.value = t('hof.upload_success')
      uploadOk.value = true
    }
    if (fileInput.value) fileInput.value.value = ''
    await load()
  } catch (e) {
    uploadMsg.value = apiErrorLabel(t, te, e)
  } finally {
    uploading.value = false
  }
}

async function download(id) {
  if (downloadingId.value) return
  if (!requireLogin()) return
  downloadErr.value = ''
  downloadingId.value = id
  try {
    await api.hofDownload(id)
  } catch (e) {
    downloadErr.value = apiErrorLabel(t, te, e)
  } finally {
    downloadingId.value = null
  }
}

// 未登录点击「选择回放文件」→ 立即 login('hof')，绝不先打开系统文件选择器。
// 登录完成后回跳 ?view=hof，用户再次点击才会打开 picker。
function onUploadButtonClick() {
  if (uploading.value) return
  if (!requireLogin()) return
  fileInput.value?.click()
}

function onFileChange(e) {
  const f = e.target.files?.[0]
  if (f) upload(f)
}

// 未登录拖拽回放 → 立即 login，不读取/不发送文件。
function onDrop(e) {
  if (!requireLogin()) return
  const f = e.dataTransfer.files?.[0]
  if (f) upload(f)
}

onMounted(() => {
  load()
  loadSingleVehicleOptions()
})

const fmtTime = value => formatDateTimeMinute(value, 2014)

function battleTypeLabel(tp) {
  if (tp === 'RATING') return t('hof.battleType.rating')
  if (tp === 'RANDOM') return t('hof.battleType.random')
  return ''
}

function rankClass(rank) {
  return rank === 1 ? 'rk-gold' : rank === 2 ? 'rk-silver' : rank === 3 ? 'rk-bronze' : ''
}

// ── Tab：单场 / 百场 ────────────────────────────────────────────
const activeTab = ref('single')

function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'hundred') {
    loadHundredList()
    loadPending()
  }
  if (tab === 'mark3') {
    loadMark3List()
    loadMark3Status()
  }
}

// ── 百场：车辆 / 排行榜 ─────────────────────────────────────────
// common/tankopedia-tier10.json 的稳定分类映射由公开页与管理页共用。
const tier10Vehicles = HUNDRED_VEHICLES

const h100VehicleId = ref(null)
const h100VehicleName = ref('')
const h100Nation = ref('')
const h100VehicleType = ref('')
const h100Rows = ref([])
const h100Loading = ref(false)
const h100Error = ref('')
const h100Page = ref(1)
const h100TotalPages = ref(0)
const h100Size = 50
let h100LoadGeneration = 0

const pendingList = ref([])
const withdrawingId = ref(null)
const h100Msg = ref('')
const h100MsgErr = ref(false)

const h100Nations = uniqueValues(tier10Vehicles.map(vehicle => vehicle.nation))
const h100VehicleTypes = uniqueValues(tier10Vehicles.map(vehicle => vehicle.vehicleType))
const filteredHundredVehicles = computed(() => tier10Vehicles.filter(vehicle =>
  (!h100Nation.value || vehicle.nation === h100Nation.value)
    && (!h100VehicleType.value || vehicle.vehicleType === h100VehicleType.value)))

const currentPending = computed(() => {
  if (!h100VehicleId.value) return null
  const id = Number(h100VehicleId.value)
  return pendingList.value.find(p => Number(p.vehicleId) === id) || null
})
const currentPendingDamage = computed(() => currentPending.value?.claimedAverageDamage)
const currentPendingBattles = computed(() => currentPending.value?.claimedBattleCount)

async function loadHundredList() {
  const generation = ++h100LoadGeneration
  h100Loading.value = true
  h100Error.value = ''
  try {
    const params = {
      page: h100Page.value,
      size: h100Size,
      nation: h100Nation.value,
      vehicleType: h100VehicleType.value,
      vehicleId: h100VehicleId.value,
    }
    const res = await api.hofHundredList(params)
    if (generation !== h100LoadGeneration) return
    h100Rows.value = res.items || []
    h100TotalPages.value = res.totalPages || 0
  } catch (e) {
    if (generation === h100LoadGeneration) h100Error.value = apiErrorLabel(t, te, e)
  } finally {
    if (generation === h100LoadGeneration) h100Loading.value = false
  }
}

function onHundredVehicleChange() {
  const v = tier10Vehicles.find(x => x.id === Number(h100VehicleId.value))
  h100VehicleName.value = v ? v.name : ''
  h100Msg.value = ''
  h100Page.value = 1
  loadHundredList()
  loadPending()
}

function onHundredVehicleFilterChange() {
  if (h100VehicleId.value
      && !filteredHundredVehicles.value.some(vehicle => vehicle.id === Number(h100VehicleId.value))) {
    h100VehicleId.value = null
    h100VehicleName.value = ''
  }
  h100Msg.value = ''
  h100Page.value = 1
  loadHundredList()
  loadPending()
}

// 个人中心百场状态（需登录）：仅登录后拉取，避免匿名浏览触发 401 跳登录。
async function loadPending() {
  if (!isAuthenticated()) {
    pendingList.value = []
    return
  }
  try {
    const status = await api.hofHundredMyStatus()
    pendingList.value = status.pending || []
  } catch {
    pendingList.value = []
  }
}

function goHundredPage(p) {
  h100Page.value = p
  loadHundredList()
}

// ── 百场：提交弹窗 ──────────────────────────────────────────────
const showSubmit = ref(false)
const submitting = ref(false)
const submitError = ref('')
const needProfile = ref(false)
const screenshotErr = ref('')
const replayErr = ref('')
const screenshotUploader = ref(null)
const replaysInput = ref(null)
const screenshotName = ref('')
const screenshotReading = ref(false)
const submitForm = reactive({
  vehicleId: null,
  averageDamage: '',
  battleCount: '',
  screenshot: '',
  replays: []
})

const hasSharedSubmitDraft = computed(() => Boolean(
  submitForm.vehicleId ||
  submitForm.averageDamage !== '' ||
  submitForm.battleCount !== ''
))
const hasManualEvidenceDraft = computed(() => Boolean(submitForm.screenshot || submitForm.replays.length))
const hasSubmitDraft = computed(() => hasSharedSubmitDraft.value || hasManualEvidenceDraft.value)

const submitHundredVehicles = computed(() => {
  const candidates = filteredHundredVehicles.value
  const draftVehicle = tier10Vehicles.find(vehicle => vehicle.id === Number(submitForm.vehicleId))
  if (!draftVehicle || candidates.some(vehicle => vehicle.id === draftVehicle.id)) return candidates
  return [draftVehicle, ...candidates].sort((a, b) => a.name.localeCompare(b.name))
})

function openSubmit() {
  if (!requireLogin()) return
  showSubmit.value = true
  submitting.value = false
  needProfile.value = false
  submitError.value = ''
  screenshotErr.value = ''
  replayErr.value = ''
  if (!submitForm.vehicleId && h100VehicleId.value) {
    submitForm.vehicleId = h100VehicleId.value
  }
}

function closeSubmit() {
  if (submitting.value) return
  showSubmit.value = false
}

function resetSharedSubmitDraft() {
  submitForm.vehicleId = null
  submitForm.averageDamage = ''
  submitForm.battleCount = ''
}

function resetManualEvidenceDraft() {
  screenshotUploader.value?.invalidatePendingRead()
  screenshotReading.value = false
  submitForm.screenshot = ''
  submitForm.replays = []
  screenshotName.value = ''
  screenshotErr.value = ''
  replayErr.value = ''
  if (replaysInput.value) replaysInput.value.value = ''
}

function resetSubmitDraft() {
  resetSharedSubmitDraft()
  resetManualEvidenceDraft()
  submitError.value = ''
  needProfile.value = false
}

function clearSubmitDraft() {
  if (!hasSubmitDraft.value || submitting.value) return
  if (!window.confirm(t('hundred.clearDraftConfirm'))) return
  resetSubmitDraft()
}

function onScreenshotSelected(images) {
  const screenshot = images[0]
  if (!screenshot) return
  screenshotErr.value = ''
  submitForm.screenshot = screenshot.data
  screenshotName.value = screenshot.name
}

function onScreenshotUploadError(code) {
  const errorKey = {
    'invalid-type': 'hundred.invalidImageType',
    'too-large': 'hundred.invalidImageSize',
  }[code] || 'hundred.imageReadError'
  screenshotErr.value = t(errorKey)
}

function onScreenshotReading(reading) {
  screenshotReading.value = reading
}

function removeScreenshot() {
  screenshotUploader.value?.invalidatePendingRead()
  screenshotReading.value = false
  submitForm.screenshot = ''
  screenshotName.value = ''
  screenshotErr.value = ''
}

function replayFileKey(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`
}

function onReplaysChange(e) {
  const input = e.target
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  if (files.some(file => !file.name.toLowerCase().endsWith('.wotbreplay'))) {
    replayErr.value = t('hundred.invalidReplayType')
    return
  }
  const knownKeys = new Set(submitForm.replays.map(replayFileKey))
  const additions = []
  let duplicateCount = 0
  for (const file of files) {
    const key = replayFileKey(file)
    if (knownKeys.has(key)) {
      duplicateCount++
      continue
    }
    knownKeys.add(key)
    additions.push(file)
  }
  if (submitForm.replays.length + additions.length > 5) {
    replayErr.value = t('hundred.replayLimit')
    return
  }
  submitForm.replays.push(...additions)
  replayErr.value = duplicateCount ? t('hundred.replayDuplicateIgnored') : ''
}

function removeReplay(index) {
  submitForm.replays.splice(index, 1)
  replayErr.value = ''
}

async function submitHundred() {
  if (submitting.value) return
  const damage = Number(submitForm.averageDamage)
  const battles = Number(submitForm.battleCount)
  const commonInvalid = !submitForm.vehicleId
    || !Number.isInteger(damage) || damage <= 0
    || !Number.isInteger(battles) || battles <= 0
  if (commonInvalid) {
    submitError.value = t('hundred.fillRequired')
    return
  }
  if (!submitForm.screenshot || screenshotReading.value || submitForm.replays.length !== 5) {
    submitError.value = t('hundred.fillRequired')
    return
  }
  // 提交前本地提示：所选车辆已有 PENDING 时立即阻止（backend 409 仍保留为最终兜底）。
  if (pendingList.value.some(p => Number(p.vehicleId) === Number(submitForm.vehicleId))) {
    submitError.value = t('hundred.pendingExistsLocal')
    return
  }
  submitting.value = true
  submitError.value = ''
  needProfile.value = false
  try {
    const fd = new FormData()
    fd.append('vehicleId', String(submitForm.vehicleId))
    fd.append('averageDamage', String(damage))
    fd.append('battleCount', String(battles))
    fd.append('screenshot', submitForm.screenshot)
    for (const r of submitForm.replays) fd.append('replays', r)
    await api.hofHundredSubmit(fd)
    resetSubmitDraft()
    showSubmit.value = false
    h100Msg.value = t('hundred.submitSuccess')
    h100MsgErr.value = false
    await loadHundredList()
    await loadPending()
  } catch (e) {
    const code = e?.code
    if (code === 'HUNDRED_PROFILE_GAME_ID_REQUIRED' || code === 'HUNDRED_PROFILE_NICKNAME_REQUIRED') {
      needProfile.value = true
      submitError.value = t('hundred.needProfile')
    } else {
      submitError.value = apiErrorLabel(t, te, e)
    }
  } finally {
    submitting.value = false
  }
}

async function withdrawPending(p) {
  if (withdrawingId.value) return
  if (!window.confirm(t('hundred.withdrawConfirm'))) return
  withdrawingId.value = p.id
  h100Msg.value = ''
  try {
    await api.hofHundredCancel(p.id)
    await loadPending()
    h100Msg.value = t('hundred.withdrawSuccess')
    h100MsgErr.value = false
  } catch (e) {
    h100Msg.value = apiErrorLabel(t, te, e)
    h100MsgErr.value = true
  } finally {
    withdrawingId.value = null
  }
}

// ── 三环：车辆 / 排行榜 ─────────────────────────────────────────
// 三环与百场共用 Tier X 车辆分类，但只允许人工证据审核。
const mark3Vehicles = HUNDRED_VEHICLES
const mark3VehicleId = ref(null)
const mark3VehicleName = ref('')
const mark3Nation = ref('')
const mark3VehicleType = ref('')
const mark3Rows = ref([])
const mark3Loading = ref(false)
const mark3Error = ref('')
const mark3Page = ref(1)
const mark3TotalPages = ref(0)
const mark3Size = 50
let mark3LoadGeneration = 0

const mark3CurrentList = ref([])
const mark3PendingList = ref([])
const mark3WithdrawingId = ref(null)
const mark3Msg = ref('')
const mark3MsgErr = ref(false)

const mark3Nations = uniqueValues(mark3Vehicles.map(vehicle => vehicle.nation))
const mark3VehicleTypes = uniqueValues(mark3Vehicles.map(vehicle => vehicle.vehicleType))
const filteredMark3Vehicles = computed(() => mark3Vehicles.filter(vehicle =>
  (!mark3Nation.value || vehicle.nation === mark3Nation.value)
    && (!mark3VehicleType.value || vehicle.vehicleType === mark3VehicleType.value)))
const selectedMark3Current = computed(() => findMark3Status(mark3CurrentList.value, mark3VehicleId.value))
const selectedMark3Pending = computed(() => findMark3Status(mark3PendingList.value, mark3VehicleId.value))

function findMark3Status(items, vehicleId) {
  if (!vehicleId) return null
  return (items || []).find(item => Number(item.vehicleId) === Number(vehicleId)) || null
}

async function loadMark3List() {
  const generation = ++mark3LoadGeneration
  mark3Loading.value = true
  mark3Error.value = ''
  try {
    const params = {
      page: mark3Page.value,
      size: mark3Size,
      nation: mark3Nation.value,
      vehicleType: mark3VehicleType.value,
      vehicleId: mark3VehicleId.value,
    }
    const res = await api.hofMark3List(params)
    if (generation !== mark3LoadGeneration) return
    mark3Rows.value = res.items || []
    mark3TotalPages.value = res.totalPages || 0
  } catch (e) {
    if (generation === mark3LoadGeneration) mark3Error.value = apiErrorLabel(t, te, e)
  } finally {
    if (generation === mark3LoadGeneration) mark3Loading.value = false
  }
}

function onMark3VehicleChange() {
  const vehicle = mark3Vehicles.find(item => item.id === Number(mark3VehicleId.value))
  mark3VehicleName.value = vehicle?.name || ''
  mark3Msg.value = ''
  mark3Page.value = 1
  loadMark3List()
  loadMark3Status()
}

function onMark3VehicleFilterChange() {
  if (mark3VehicleId.value
      && !filteredMark3Vehicles.value.some(vehicle => vehicle.id === Number(mark3VehicleId.value))) {
    mark3VehicleId.value = null
    mark3VehicleName.value = ''
  }
  mark3Msg.value = ''
  mark3Page.value = 1
  loadMark3List()
  loadMark3Status()
}

// 个人三环状态仅在已登录时读取，匿名看榜单不会触发登录跳转。
async function loadMark3Status() {
  if (!isAuthenticated()) {
    mark3CurrentList.value = []
    mark3PendingList.value = []
    return
  }
  try {
    const status = await api.hofMark3MyStatus()
    mark3CurrentList.value = Array.isArray(status.current) ? status.current : []
    mark3PendingList.value = Array.isArray(status.pending) ? status.pending : []
  } catch {
    mark3CurrentList.value = []
    mark3PendingList.value = []
  }
}

function goMark3Page(nextPage) {
  mark3Page.value = nextPage
  loadMark3List()
}

// ── 三环：人工提交弹窗 ─────────────────────────────────────────
const showMark3Submit = ref(false)
const mark3Submitting = ref(false)
const mark3SubmitError = ref('')
const mark3NeedProfile = ref(false)
const mark3ScreenshotErr = ref('')
const mark3ReplayErr = ref('')
const mark3ScreenshotUploader = ref(null)
const mark3ReplaysInput = ref(null)
const mark3ScreenshotsReading = ref(false)
const mark3SubmitForm = reactive({
  vehicleId: null,
  battleCount: '',
  averageDamage: '',
  winRate: '',
  proofScreenshots: [],
  replays: [],
})

const mark3HasDraft = computed(() => Boolean(
  mark3SubmitForm.vehicleId
  || mark3SubmitForm.battleCount !== ''
  || mark3SubmitForm.averageDamage !== ''
  || mark3SubmitForm.winRate !== ''
  || mark3SubmitForm.proofScreenshots.length
  || mark3SubmitForm.replays.length
))
const submitMark3Vehicles = computed(() => {
  const candidates = filteredMark3Vehicles.value
  const draftVehicle = mark3Vehicles.find(vehicle => vehicle.id === Number(mark3SubmitForm.vehicleId))
  if (!draftVehicle || candidates.some(vehicle => vehicle.id === draftVehicle.id)) return candidates
  return [draftVehicle, ...candidates].sort((a, b) => a.name.localeCompare(b.name))
})

function openMark3Submit() {
  if (!requireLogin()) return
  showMark3Submit.value = true
  mark3Submitting.value = false
  mark3NeedProfile.value = false
  mark3SubmitError.value = ''
  mark3ScreenshotErr.value = ''
  mark3ReplayErr.value = ''
  if (!mark3SubmitForm.vehicleId && mark3VehicleId.value) {
    mark3SubmitForm.vehicleId = mark3VehicleId.value
  }
}

function closeMark3Submit() {
  if (!mark3Submitting.value) showMark3Submit.value = false
}

function resetMark3Draft() {
  mark3ScreenshotUploader.value?.invalidatePendingRead()
  mark3ScreenshotsReading.value = false
  mark3SubmitForm.vehicleId = null
  mark3SubmitForm.battleCount = ''
  mark3SubmitForm.averageDamage = ''
  mark3SubmitForm.winRate = ''
  mark3SubmitForm.proofScreenshots = []
  mark3SubmitForm.replays = []
  mark3SubmitError.value = ''
  mark3NeedProfile.value = false
  mark3ScreenshotErr.value = ''
  mark3ReplayErr.value = ''
  if (mark3ReplaysInput.value) mark3ReplaysInput.value.value = ''
}

function clearMark3Draft() {
  if (!mark3HasDraft.value || mark3Submitting.value) return
  if (!window.confirm(t('mark3.clearDraftConfirm'))) return
  resetMark3Draft()
}

function mark3ReplayFileKey(file) {
  return [file.name, file.size, file.lastModified].join('\u0000')
}

function collectUniqueMark3Replays(files) {
  const knownKeys = new Set(mark3SubmitForm.replays.map(mark3ReplayFileKey))
  const additions = []
  let duplicateCount = 0
  for (const file of files) {
    const key = mark3ReplayFileKey(file)
    if (knownKeys.has(key)) {
      duplicateCount++
      continue
    }
    knownKeys.add(key)
    additions.push(file)
  }
  return { additions, duplicateCount }
}

function onMark3ScreenshotsSelected(screenshots, duplicateCount) {
  mark3ScreenshotErr.value = ''
  if (!screenshots.length) {
    mark3ScreenshotErr.value = duplicateCount ? t('mark3.screenshotDuplicateIgnored') : ''
    return
  }
  mark3SubmitForm.proofScreenshots.push(...screenshots)
  mark3ScreenshotErr.value = duplicateCount ? t('mark3.screenshotDuplicateIgnored') : ''
}

function onMark3ScreenshotUploadError(code) {
  const errorKey = {
    'invalid-type': 'mark3.invalidImageType',
    'too-large': 'mark3.invalidImageSize',
    'too-many': 'mark3.screenshotLimit',
  }[code] || 'mark3.imageReadError'
  mark3ScreenshotErr.value = t(errorKey)
}

function onMark3ScreenshotsReading(reading) {
  mark3ScreenshotsReading.value = reading
}

function removeMark3Screenshot(index) {
  mark3ScreenshotUploader.value?.invalidatePendingRead()
  mark3SubmitForm.proofScreenshots.splice(index, 1)
  mark3ScreenshotErr.value = ''
}

function onMark3ReplaysChange(event) {
  const input = event.target
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  if (files.some(file => !file.name.toLowerCase().endsWith('.wotbreplay'))) {
    mark3ReplayErr.value = t('mark3.invalidReplayType')
    return
  }
  const { additions, duplicateCount } = collectUniqueMark3Replays(files)
  if (mark3SubmitForm.replays.length + additions.length > 5) {
    mark3ReplayErr.value = t('mark3.replayLimit')
    return
  }
  mark3SubmitForm.replays.push(...additions)
  mark3ReplayErr.value = duplicateCount ? t('mark3.replayDuplicateIgnored') : ''
}

function removeMark3Replay(index) {
  mark3SubmitForm.replays.splice(index, 1)
  mark3ReplayErr.value = ''
}

function isMark3WinRate(value) {
  const rate = Number(value)
  return Number.isFinite(rate)
    && rate >= 0
    && rate <= 100
    && Math.abs(rate * 100 - Math.round(rate * 100)) < 1e-8
}

function mark3SubmissionValues() {
  return {
    vehicleId: Number(mark3SubmitForm.vehicleId),
    battleCount: Number(mark3SubmitForm.battleCount),
    averageDamage: Number(mark3SubmitForm.averageDamage),
    winRate: Number(mark3SubmitForm.winRate),
  }
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function hasValidMark3Metrics(values) {
  return isPositiveInteger(values.vehicleId)
    && isPositiveInteger(values.battleCount)
    && isPositiveInteger(values.averageDamage)
    && mark3SubmitForm.winRate !== ''
    && isMark3WinRate(values.winRate)
}

function hasCompleteMark3Evidence() {
  const screenshotCount = mark3SubmitForm.proofScreenshots.length
  return !mark3ScreenshotsReading.value
    && screenshotCount >= 1
    && screenshotCount <= 2
    && mark3SubmitForm.replays.length === 5
}

function mark3SubmissionValidationKey(values) {
  if (!hasValidMark3Metrics(values) || !hasCompleteMark3Evidence()) return 'mark3.fillRequired'
  if (findMark3Status(mark3CurrentList.value, values.vehicleId)) return 'mark3.currentExistsLocal'
  if (findMark3Status(mark3PendingList.value, values.vehicleId)) return 'mark3.pendingExistsLocal'
  return ''
}

function createMark3SubmissionFormData(values) {
  const formData = new FormData()
  formData.append('vehicleId', String(values.vehicleId))
  formData.append('battleCount', String(values.battleCount))
  formData.append('averageDamage', String(values.averageDamage))
  formData.append('winRate', String(values.winRate))
  for (const screenshot of mark3SubmitForm.proofScreenshots) formData.append('proofScreenshots', screenshot.data)
  for (const replay of mark3SubmitForm.replays) formData.append('replays', replay)
  return formData
}

function isMark3ProfileError(error) {
  return ['MARK3_PROFILE_GAME_ID_REQUIRED', 'MARK3_PROFILE_NICKNAME_REQUIRED'].includes(error?.code)
}

async function submitMark3() {
  if (mark3Submitting.value) return
  const values = mark3SubmissionValues()
  const validationKey = mark3SubmissionValidationKey(values)
  if (validationKey) {
    mark3SubmitError.value = t(validationKey)
    return
  }
  mark3Submitting.value = true
  mark3SubmitError.value = ''
  mark3NeedProfile.value = false
  try {
    await api.hofMark3Submit(createMark3SubmissionFormData(values))
    resetMark3Draft()
    showMark3Submit.value = false
    mark3Msg.value = t('mark3.submitSuccess')
    mark3MsgErr.value = false
    await loadMark3List()
    await loadMark3Status()
  } catch (e) {
    if (isMark3ProfileError(e)) {
      mark3NeedProfile.value = true
      mark3SubmitError.value = t('mark3.needProfile')
    } else {
      mark3SubmitError.value = apiErrorLabel(t, te, e)
    }
  } finally {
    mark3Submitting.value = false
  }
}

async function withdrawMark3Pending(submission) {
  if (mark3WithdrawingId.value) return
  if (!window.confirm(t('mark3.withdrawConfirm'))) return
  mark3WithdrawingId.value = submission.id
  mark3Msg.value = ''
  try {
    await api.hofMark3Cancel(submission.id)
    await loadMark3Status()
    mark3Msg.value = t('mark3.withdrawSuccess')
    mark3MsgErr.value = false
  } catch (e) {
    mark3Msg.value = apiErrorLabel(t, te, e)
    mark3MsgErr.value = true
  } finally {
    mark3WithdrawingId.value = null
  }
}

function formatMark3Number(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString() : '—'
}

function formatMark3WinRate(value) {
  const number = Number(value)
  return Number.isFinite(number)
    ? `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : '—'
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
</script>

<template>
  <div class="lb-wrap">
    <div class="tabs">
      <button type="button" :class="{ active: activeTab === 'single' }" @click="switchTab('single')">{{ $t('hof.singleTab') }}</button>
      <button type="button" :class="{ active: activeTab === 'hundred' }" @click="switchTab('hundred')">{{ $t('hundred.tab') }}</button>
      <button type="button" :class="{ active: activeTab === 'mark3' }" @click="switchTab('mark3')">{{ $t('mark3.tab') }}</button>
    </div>

    <div v-show="activeTab === 'single'">
      <header class="lb-head">
        <span class="lb-kicker">{{ $t('hof.btn') }}</span>
        <h1>{{ $t('hof.title') }}</h1>
        <p>{{ $t('hof.subtitle') }}</p>
      </header>

      <div class="lb-submit-row">
        <button type="button" class="filebtn" @click="showUploadModal = true">
          <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg>{{ $t('hof.submit_entry') }}
        </button>
        <span v-if="uploadMsg" class="lb-upload-msg" :class="{ err: !uploadOk }">{{ uploadMsg }}</span>
      </div>

      <!-- 提交记录 Modal（§29：上传入口不再长期占据首屏，Ranking 成为核心） -->
      <div v-if="showUploadModal" class="modal-overlay" @click.self="showUploadModal = false">
        <div class="modal hof-upload-modal" role="dialog" aria-modal="true" :aria-label="$t('hof.upload_title')">
          <div class="modal-head">
            <h2>{{ $t('hof.upload_title') }}</h2>
            <button type="button" class="modal-x" :aria-label="$t('app.close')" @click="showUploadModal = false">&times;</button>
          </div>
          <section class="lb-upload-section"
                   @dragover.prevent="dragging = true"
                   @dragleave.prevent="dragging = false"
                   @drop.prevent="dragging = false; onDrop($event)">
            <div class="lb-upload-card" :class="{ dragging }">
              <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
              <div class="up-title">{{ $t('hof.upload_title') }}</div>
              <div class="up-sub">{{ $t('hof.upload_hint') }}</div>
              <input ref="fileInput" type="file" accept=".wotbreplay" class="lb-hidden-input" @change="onFileChange" :disabled="uploading" />
              <button type="button" class="filebtn" :class="{ 'lb-uploading': uploading }" @click="onUploadButtonClick">
                <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
                {{ uploading ? $t('hof.uploading') : $t('hof.upload_btn') }}
              </button>
            </div>
            <p v-if="uploadMsg" class="lb-upload-msg" :class="{ err: !uploadOk }">{{ uploadMsg }}</p>
          </section>
        </div>
      </div>

      <div class="lb-toolbar">
        <label class="lb-limit"><span class="lb-label">{{ $t('hof.nation') }}</span>
          <select v-model="singleNation" :disabled="singleVehicleOptionsLoading" @change="onSingleVehicleConditionChange">
            <option value="">{{ $t('hof.allNations') }}</option>
            <option v-for="nation in singleVehicleNations" :key="nation" :value="nation">{{ vehicleValueLabel(nation) }}</option>
          </select>
        </label>
        <label class="lb-limit"><span class="lb-label">{{ $t('hof.vehicleType') }}</span>
          <select v-model="singleVehicleType" :disabled="singleVehicleOptionsLoading" @change="onSingleVehicleConditionChange">
            <option value="">{{ $t('hof.allVehicleTypes') }}</option>
            <option v-for="type in singleVehicleTypes" :key="type" :value="type">{{ vehicleValueLabel(type) }}</option>
          </select>
        </label>
        <label class="lb-limit"><span class="lb-label">{{ $t('hof.vehicleTier') }}</span>
          <select v-model="singleVehicleTier" :disabled="singleVehicleOptionsLoading" @change="onSingleVehicleConditionChange">
            <option value="">{{ $t('hof.allVehicleTiers') }}</option>
            <option v-for="tier in singleVehicleTiers" :key="tier" :value="String(tier)">T{{ tier }}</option>
          </select>
        </label>
        <label class="lb-limit"><span class="lb-label">{{ $t('hof.selectVehicle') }}</span>
          <select v-model="selectedTankId" class="hof-vehicle-select" :disabled="singleVehicleOptionsLoading" @change="onSingleVehicleChange">
            <option :value="null">{{ $t('hof.all_tanks') }}</option>
            <option v-for="vehicle in filteredSingleVehicles" :key="vehicle.tankId" :value="vehicle.tankId">{{ vehicleOptionLabel(vehicle) }}</option>
          </select>
        </label>
        <label class="lb-limit"><span class="lb-label">{{ $t('hof.battleTypeLabel') }}</span>
          <select v-model="battleType" @change="onBattleTypeChange">
            <option value="">{{ $t('hof.battleType.all') }}</option>
            <option value="RANDOM">{{ $t('hof.battleType.random') }}</option>
            <option value="RATING">{{ $t('hof.battleType.rating') }}</option>
          </select>
        </label>
        <label class="lb-limit"><span class="lb-label">{{ $t('hof.nicknameSearch') }}</span>
          <span class="lb-nick-row"><input v-model="nickname" class="lb-nick-input" :placeholder="$t('hof.nicknamePlaceholder')" @keyup.enter="searchNickname" />
          <button type="button" class="ghost sm" @click="searchNickname">{{ $t('hof.search') }}</button></span>
        </label>
        <label class="lb-limit"><span class="lb-label">{{ $t('hof.limit') }}</span>
          <select v-model.number="limit" @change="page = 1; load()">
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>
        <button v-if="selectedTankId" type="button" class="ghost sm" @click="clearFilter">
          <svg class="ic" viewBox="0 0 24 24"><path d="M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM14.8 9.2l-5.6 5.6M9.2 9.2l5.6 5.6" /></svg>{{ $t('hof.all_tanks') }}
        </button>
        <button type="button" class="ghost sm" :disabled="loading" @click="load">
          <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('hof.refresh') }}
        </button>
      </div>

      <p v-if="singleVehicleOptionsError" class="error">{{ singleVehicleOptionsError }}</p>

      <p v-if="selectedTankId" class="lb-filter-hint">
        {{ $t('hof.filter_tank') }}: <strong>{{ selectedTankName }}</strong>
      </p>

      <p v-if="downloadErr" class="lb-upload-msg err">{{ downloadErr }}</p>
      <p v-if="error" class="error">{{ $t('hof.error') }}: {{ error }}</p>
      <p v-else-if="loading" class="muted">{{ $t('hof.loading') }}</p>
      <p v-else-if="!rows.length" class="muted">{{ $t('hof.empty') }}</p>
      <div v-else class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>{{ $t('hof.rank') }}</th>
              <th>{{ $t('hof.nickname') }}</th>
              <th>{{ $t('hof.tank_name') }}</th>
              <th>{{ $t('hof.battleTypeLabel') }}</th>
              <th>{{ $t('hof.damage_dealt') }}</th>
              <th>{{ $t('hof.map') }}</th>
              <th>{{ $t('hof.version') }}</th>
              <th>{{ $t('hof.battle_time') }}</th>
              <th>{{ $t('hof.upload_time') }}</th>
              <th>{{ $t('hof.replay') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><span class="rk" :class="rankClass(r.rank)">{{ r.rank }}</span></td>
              <td>{{ r.nickname }}</td>
              <td>
                <button
                  v-if="!selectedTankId"
                  type="button"
                  class="lb-tank-link"
                  :title="$t('hof.filter_by_tank')"
                  @click="filterByTank(r.tankId, r.tankName)"
                >{{ r.tankName }}</button>
                <span v-else>{{ r.tankName }}</span>
              </td>
              <td><span class="bt-badge" :class="r.battleType === 'RATING' ? 'bt-rating' : 'bt-random'">{{ battleTypeLabel(r.battleType) }}</span></td>
              <td class="lb-dmg">{{ r.damageDealt.toLocaleString() }}</td>
              <td>{{ mapLabel(r.mapName, locale) }}</td>
              <td class="lb-version">{{ r.version || '-' }}</td>
              <td class="lb-time">{{ fmtTime(r.battleTime) || '-' }}</td>
              <td class="lb-time">{{ fmtTime(r.createdAt) }}</td>
              <td class="lb-replay">
                <button
                  v-if="r.replayAvailable"
                  type="button"
                  class="lb-download"
                  :disabled="downloadingId === r.id"
                  :title="downloadingId === r.id ? $t('hof.downloading') : $t('hof.download')"
                  :aria-label="downloadingId === r.id ? $t('hof.downloading') : $t('hof.download')"
                  @click="download(r.id)"
                >
                  <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 15l4 4 4-4M12 3v16" /></svg>
                </button>
                <span v-else class="lb-no-replay">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="totalPages > 1" class="pagination">
        <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">{{ $t('hof.prev') }}</button>
        <span>{{ $t('hof.page_info', { page, total: totalPages }) }}</span>
        <button type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t('hof.next') }}</button>
      </div>
    </div>

    <div v-show="activeTab === 'hundred'" class="h100-pane">
      <header class="lb-head">
        <span class="lb-kicker">{{ $t('hof.btn') }}</span>
        <h1>{{ $t('hundred.tab') }}</h1>
        <p>{{ $t('hundred.subtitle') }}</p>
      </header>

      <div class="lb-toolbar h100-toolbar">
        <label class="lb-limit h100-filter"><span class="lb-label">{{ $t('hundred.nation') }}</span>
          <select v-model="h100Nation" @change="onHundredVehicleFilterChange">
            <option value="">{{ $t('hundred.allNations') }}</option>
            <option v-for="nation in h100Nations" :key="nation" :value="nation">{{ vehicleValueLabel(nation) }}</option>
          </select>
        </label>
        <label class="lb-limit h100-filter"><span class="lb-label">{{ $t('hundred.vehicleType') }}</span>
          <select v-model="h100VehicleType" @change="onHundredVehicleFilterChange">
            <option value="">{{ $t('hundred.allVehicleTypes') }}</option>
            <option v-for="vehicleType in h100VehicleTypes" :key="vehicleType" :value="vehicleType">{{ vehicleValueLabel(vehicleType) }}</option>
          </select>
        </label>
        <label class="lb-limit h100-vehicle-filter"><span class="lb-label">{{ $t('hundred.selectVehicle') }}</span>
          <select v-model="h100VehicleId" class="h100-vehicle-select" @change="onHundredVehicleChange">
            <option :value="null">{{ $t('hundred.default') }}</option>
            <option v-for="vehicle in filteredHundredVehicles" :key="vehicle.id" :value="vehicle.id">{{ vehicle.name }}</option>
          </select>
        </label>
        <button type="button" class="ghost sm" :disabled="h100Loading" @click="loadHundredList">
          <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('hof.refresh') }}
        </button>
        <button type="button" class="ghost sm h100-submit-btn" :disabled="!!currentPending || h100Loading" @click="openSubmit">
          {{ $t('hundred.submit') }}
        </button>
      </div>

      <p v-if="h100VehicleId" class="lb-filter-hint">
        {{ $t('hundred.selectVehicle') }}: <strong>{{ h100VehicleName }}</strong>
      </p>

      <div v-if="currentPending" class="h100-pending-card">
        <div class="h100-pending-body">
          <div class="h100-pending-title">{{ $t('hundred.pendingTitle', { vehicle: currentPending.vehicleName || h100VehicleName }) }}</div>
          <div class="h100-pending-meta">
            <span>{{ $t('hundred.pendingDamage') }}: <strong>{{ currentPendingDamage != null ? currentPendingDamage.toLocaleString() : '—' }}</strong></span>
            <span>{{ $t('hundred.pendingBattles') }}: <strong>{{ currentPendingBattles != null ? currentPendingBattles.toLocaleString() : '—' }}</strong></span>
            <span class="h100-pending-time">{{ $t('hundred.pendingTime') }}: {{ fmtDate(currentPending.submittedAt) || '-' }}</span>
          </div>
        </div>
        <button type="button" class="ghost sm danger" :disabled="withdrawingId === currentPending.id" @click="withdrawPending(currentPending)">
          {{ withdrawingId === currentPending.id ? $t('hundred.withdrawing') : $t('hundred.withdraw') }}
        </button>
      </div>

      <p v-if="h100Msg" class="lb-upload-msg" :class="{ err: h100MsgErr }">{{ h100Msg }}</p>

      <p v-if="h100Error" class="error">{{ h100Error }}</p>
      <p v-else-if="h100Loading" class="muted">{{ $t('hundred.loading') }}</p>
      <p v-else-if="!h100Rows.length" class="muted">{{ $t(h100VehicleId ? 'hundred.empty' : 'hundred.emptyDefault') }}</p>
      <div v-else class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>{{ $t('hundred.rank') }}</th>
              <th>{{ $t('hundred.vehicle') }}</th>
              <th>{{ $t('hundred.nickname') }}</th>
              <th>{{ $t('hundred.avgDamage') }}</th>
              <th>{{ $t('hundred.battleCount') }}</th>
              <th>{{ $t('hundred.approvedAt') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in h100Rows" :key="r.id">
              <td><span class="rk" :class="rankClass(r.rank)">{{ r.rank }}</span></td>
              <td>{{ r.vehicleName }}</td>
              <td>{{ r.nickname }}</td>
              <td class="lb-dmg">{{ r.approvedAverageDamage.toLocaleString() }}</td>
              <td>{{ r.approvedBattleCount }}</td>
              <td class="lb-time">{{ fmtDate(r.approvedAt) || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="h100TotalPages > 1" class="pagination">
        <button type="button" :disabled="h100Page <= 1" @click="goHundredPage(h100Page - 1)">{{ $t('hundred.prev') }}</button>
        <span>{{ $t('hundred.pageInfo', { page: h100Page, total: h100TotalPages }) }}</span>
        <button type="button" :disabled="h100Page >= h100TotalPages" @click="goHundredPage(h100Page + 1)">{{ $t('hundred.next') }}</button>
      </div>
    </div>

    <div v-show="activeTab === 'mark3'" class="h100-pane mark3-pane">
      <header class="lb-head">
        <span class="lb-kicker">{{ $t('hof.btn') }}</span>
        <h1>{{ $t('mark3.tab') }}</h1>
        <p>{{ $t('mark3.subtitle') }}</p>
      </header>

      <div class="lb-toolbar h100-toolbar">
        <label class="lb-limit mark3-filter"><span class="lb-label">{{ $t('mark3.nation') }}</span>
          <select v-model="mark3Nation" @change="onMark3VehicleFilterChange">
            <option value="">{{ $t('mark3.allNations') }}</option>
            <option v-for="nation in mark3Nations" :key="nation" :value="nation">{{ vehicleValueLabel(nation) }}</option>
          </select>
        </label>
        <label class="lb-limit mark3-filter"><span class="lb-label">{{ $t('mark3.vehicleType') }}</span>
          <select v-model="mark3VehicleType" @change="onMark3VehicleFilterChange">
            <option value="">{{ $t('mark3.allVehicleTypes') }}</option>
            <option v-for="vehicleType in mark3VehicleTypes" :key="vehicleType" :value="vehicleType">{{ vehicleValueLabel(vehicleType) }}</option>
          </select>
        </label>
        <label class="lb-limit mark3-vehicle-filter"><span class="lb-label">{{ $t('mark3.selectVehicle') }}</span>
          <select v-model="mark3VehicleId" class="mark3-vehicle-select" @change="onMark3VehicleChange">
            <option :value="null">{{ $t('mark3.default') }}</option>
            <option v-for="vehicle in filteredMark3Vehicles" :key="vehicle.id" :value="vehicle.id">{{ vehicle.name }}</option>
          </select>
        </label>
        <button type="button" class="ghost sm" :disabled="mark3Loading" @click="loadMark3List">
          <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('hof.refresh') }}
        </button>
        <button type="button" class="ghost sm h100-submit-btn mark3-submit-btn"
                :disabled="!!selectedMark3Current || !!selectedMark3Pending || mark3Loading" @click="openMark3Submit">
          {{ $t('mark3.submit') }}
        </button>
      </div>

      <p v-if="mark3VehicleId" class="lb-filter-hint">
        {{ $t('mark3.selectVehicle') }}: <strong>{{ mark3VehicleName }}</strong>
      </p>

      <div v-if="selectedMark3Current" class="h100-pending-card mark3-current-card">
        <div class="h100-pending-body">
          <div class="h100-pending-title">{{ $t('mark3.currentTitle', { vehicle: selectedMark3Current.vehicleName || mark3VehicleName }) }}</div>
          <div class="h100-pending-meta">
            <span>{{ $t('mark3.currentBattles') }}: <strong>{{ formatMark3Number(selectedMark3Current.approvedBattleCount ?? selectedMark3Current.claimedBattleCount) }}</strong></span>
            <span>{{ $t('mark3.currentDamage') }}: <strong>{{ formatMark3Number(selectedMark3Current.approvedAverageDamage ?? selectedMark3Current.claimedAverageDamage) }}</strong></span>
            <span>{{ $t('mark3.currentWinRate') }}: <strong>{{ formatMark3WinRate(selectedMark3Current.approvedWinRate ?? selectedMark3Current.claimedWinRate) }}</strong></span>
          </div>
        </div>
      </div>
      <div v-else-if="selectedMark3Pending" class="h100-pending-card">
        <div class="h100-pending-body">
          <div class="h100-pending-title">{{ $t('mark3.pendingTitle', { vehicle: selectedMark3Pending.vehicleName || mark3VehicleName }) }}</div>
          <div class="h100-pending-meta">
            <span>{{ $t('mark3.pendingBattles') }}: <strong>{{ formatMark3Number(selectedMark3Pending.claimedBattleCount) }}</strong></span>
            <span>{{ $t('mark3.pendingDamage') }}: <strong>{{ formatMark3Number(selectedMark3Pending.claimedAverageDamage) }}</strong></span>
            <span>{{ $t('mark3.pendingWinRate') }}: <strong>{{ formatMark3WinRate(selectedMark3Pending.claimedWinRate) }}</strong></span>
            <span class="h100-pending-time">{{ $t('mark3.pendingTime') }}: {{ fmtDate(selectedMark3Pending.submittedAt) || '-' }}</span>
          </div>
        </div>
        <button type="button" class="ghost sm danger" :disabled="mark3WithdrawingId === selectedMark3Pending.id" @click="withdrawMark3Pending(selectedMark3Pending)">
          {{ mark3WithdrawingId === selectedMark3Pending.id ? $t('mark3.withdrawing') : $t('mark3.withdraw') }}
        </button>
      </div>

      <p v-if="mark3Msg" class="lb-upload-msg" :class="{ err: mark3MsgErr }">{{ mark3Msg }}</p>

      <p v-if="mark3Error" class="error">{{ mark3Error }}</p>
      <p v-else-if="mark3Loading" class="muted">{{ $t('mark3.loading') }}</p>
      <p v-else-if="!mark3Rows.length" class="muted">{{ $t(mark3VehicleId ? 'mark3.empty' : 'mark3.emptyDefault') }}</p>
      <div v-else class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>{{ $t('mark3.rank') }}</th>
              <th>{{ $t('mark3.vehicle') }}</th>
              <th>{{ $t('mark3.nickname') }}</th>
              <th>{{ $t('mark3.battleCount') }}</th>
              <th>{{ $t('mark3.avgDamage') }}</th>
              <th>{{ $t('mark3.winRate') }}</th>
              <th>{{ $t('mark3.approvedAt') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in mark3Rows" :key="row.id">
              <td><span class="rk" :class="rankClass(row.rank)">{{ row.rank }}</span></td>
              <td>{{ row.vehicleName }}</td>
              <td>{{ row.nickname }}</td>
              <td class="lb-dmg">{{ formatMark3Number(row.approvedBattleCount) }}</td>
              <td>{{ formatMark3Number(row.approvedAverageDamage) }}</td>
              <td>{{ formatMark3WinRate(row.approvedWinRate) }}</td>
              <td class="lb-time">{{ fmtDate(row.approvedAt) || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="mark3TotalPages > 1" class="pagination">
        <button type="button" :disabled="mark3Page <= 1" @click="goMark3Page(mark3Page - 1)">{{ $t('mark3.prev') }}</button>
        <span>{{ $t('mark3.pageInfo', { page: mark3Page, total: mark3TotalPages }) }}</span>
        <button type="button" :disabled="mark3Page >= mark3TotalPages" @click="goMark3Page(mark3Page + 1)">{{ $t('mark3.next') }}</button>
      </div>
    </div>

    <div v-show="showSubmit" class="modal-overlay h100-submit-overlay" @click.self="closeSubmit">
      <div class="modal h100-modal">
        <h2>{{ $t('hundred.submitTitle') }}</h2>
        <p>{{ $t('hundred.submitDesc') }}</p>
        <p class="h100-draft-hint">{{ $t('hundred.draftHint') }}</p>

        <div class="h100-field">
          <label class="h100-field-label" for="h100-submit-vehicle">{{ $t('hundred.selectVehicle') }}</label>
          <select id="h100-submit-vehicle" v-model="submitForm.vehicleId">
            <option :value="null" disabled>{{ $t('hundred.chooseVehicle') }}</option>
            <option v-for="vehicle in submitHundredVehicles" :key="vehicle.id" :value="vehicle.id">{{ vehicle.name }}</option>
          </select>
        </div>

        <div class="h100-field">
          <label class="h100-field-label" for="h100-submit-damage">{{ $t('hundred.claimedDamage') }}</label>
          <input id="h100-submit-damage" v-model.number="submitForm.averageDamage" type="number" min="1" step="1" />
          <small>{{ $t('hundred.claimedDamageHint') }}</small>
        </div>

        <div class="h100-field">
          <label class="h100-field-label" for="h100-submit-battles">{{ $t('hundred.claimedBattles') }}</label>
          <input id="h100-submit-battles" v-model.number="submitForm.battleCount" type="number" min="1" step="1" />
          <small>{{ $t('hundred.claimedBattlesHint') }}</small>
        </div>

        <div class="h100-manual-evidence">
          <div class="h100-field">
            <span class="h100-field-label">{{ $t('hundred.screenshotLabel') }}</span>
          <ImageDataUploader ref="screenshotUploader"
                              @selected="onScreenshotSelected"
                              @error="onScreenshotUploadError"
                              @reading="onScreenshotReading" />
            <small>{{ $t('hundred.screenshotHint') }}</small>
            <p v-if="screenshotReading" class="h100-file-reading">{{ $t('hundred.readingScreenshot') }}</p>
            <div v-else-if="screenshotName" class="h100-selected-file">
              <span class="h100-selected-name" :title="screenshotName">{{ screenshotName }}</span>
              <button type="button" class="h100-remove-file" :aria-label="$t('hundred.removeFile', { name: screenshotName })" @click="removeScreenshot">×</button>
            </div>
            <p v-if="screenshotErr" class="h100-err">{{ screenshotErr }}</p>
          </div>

          <div class="h100-field">
            <span class="h100-field-label">{{ $t('hundred.replaysLabel') }}
              <span class="h100-counter">{{ $t('hundred.replayCounter', { current: submitForm.replays.length }) }}</span>
            </span>
            <input ref="replaysInput" type="file" accept=".wotbreplay" multiple @change="onReplaysChange" />
            <small>{{ $t('hundred.replaysHint') }}</small>
            <ul v-if="submitForm.replays.length" class="h100-selected-files">
              <li v-for="(replay, index) in submitForm.replays" :key="replayFileKey(replay)" class="h100-selected-file">
                <span class="h100-file-index">{{ index + 1 }}</span>
                <span class="h100-selected-name" :title="replay.name">{{ replay.name }}</span>
                <button type="button" class="h100-remove-file" :aria-label="$t('hundred.removeFile', { name: replay.name })" @click="removeReplay(index)">×</button>
              </li>
            </ul>
            <p v-if="replayErr" class="h100-err">{{ replayErr }}</p>
          </div>
        </div>

        <p v-if="needProfile" class="h100-need-profile">
          {{ submitError }} <a href="/?view=profile">{{ $t('hundred.goProfile') }}</a>
        </p>
        <p v-else-if="submitError" class="h100-err">{{ submitError }}</p>

        <div class="modal-actions">
          <button type="button" class="ghost danger h100-clear-draft" :disabled="submitting || !hasSubmitDraft" @click="clearSubmitDraft">{{ $t('hundred.clearDraft') }}</button>
          <button type="button" class="ghost" :disabled="submitting" @click="closeSubmit">{{ $t('app.close') }}</button>
          <button type="button" class="filebtn h100-modal-submit"
                  :disabled="submitting || screenshotReading" @click="submitHundred">
            {{ submitting ? $t('hundred.submitting') : $t('hundred.submit') }}
          </button>
        </div>
      </div>
    </div>

    <div v-show="showMark3Submit" class="modal-overlay mark3-submit-overlay" @click.self="closeMark3Submit">
      <div class="modal h100-modal mark3-modal">
        <h2>{{ $t('mark3.submitTitle') }}</h2>
        <p>{{ $t('mark3.submitDesc') }}</p>
        <p class="h100-draft-hint">{{ $t('mark3.draftHint') }}</p>

        <div class="h100-field">
          <label class="h100-field-label" for="mark3-submit-vehicle">{{ $t('mark3.selectVehicle') }}</label>
          <select id="mark3-submit-vehicle" v-model="mark3SubmitForm.vehicleId">
            <option :value="null" disabled>{{ $t('mark3.chooseVehicle') }}</option>
            <option v-for="vehicle in submitMark3Vehicles" :key="vehicle.id" :value="vehicle.id">{{ vehicle.name }}</option>
          </select>
        </div>

        <div class="h100-field">
          <label class="h100-field-label" for="mark3-submit-battles">{{ $t('mark3.claimedBattles') }}</label>
          <input id="mark3-submit-battles" v-model.number="mark3SubmitForm.battleCount" type="number" min="1" step="1" />
          <small>{{ $t('mark3.claimedBattlesHint') }}</small>
        </div>

        <div class="h100-field">
          <label class="h100-field-label" for="mark3-submit-damage">{{ $t('mark3.claimedDamage') }}</label>
          <input id="mark3-submit-damage" v-model.number="mark3SubmitForm.averageDamage" type="number" min="1" step="1" />
          <small>{{ $t('mark3.claimedDamageHint') }}</small>
        </div>

        <div class="h100-field">
          <label class="h100-field-label" for="mark3-submit-win-rate">{{ $t('mark3.claimedWinRate') }}</label>
          <input id="mark3-submit-win-rate" v-model.number="mark3SubmitForm.winRate" type="number" min="0" max="100" step="0.01" />
          <small>{{ $t('mark3.claimedWinRateHint') }}</small>
        </div>

        <div class="h100-field">
          <span class="h100-field-label">{{ $t('mark3.screenshotLabel') }}
            <span class="h100-counter">{{ $t('mark3.screenshotCounter', { current: mark3SubmitForm.proofScreenshots.length }) }}</span>
          </span>
          <ImageDataUploader ref="mark3ScreenshotUploader" multiple :max-files="2"
                              :existing-keys="mark3SubmitForm.proofScreenshots.map(screenshot => screenshot.key)"
                              @selected="onMark3ScreenshotsSelected"
                              @error="onMark3ScreenshotUploadError"
                              @reading="onMark3ScreenshotsReading" />
          <small>{{ $t('mark3.screenshotHint') }}</small>
          <p v-if="mark3ScreenshotsReading" class="h100-file-reading">{{ $t('mark3.readingScreenshots') }}</p>
          <ul v-if="mark3SubmitForm.proofScreenshots.length" class="h100-selected-files mark3-proof-list">
            <li v-for="(screenshot, index) in mark3SubmitForm.proofScreenshots" :key="screenshot.key" class="h100-selected-file mark3-proof-item">
              <img class="mark3-proof-preview" :src="screenshot.data" :alt="$t('mark3.screenshotPreview', { number: index + 1 })" />
              <span class="h100-file-index">{{ index + 1 }}</span>
              <span class="h100-selected-name" :title="screenshot.name">{{ screenshot.name }}</span>
              <button type="button" class="h100-remove-file" :aria-label="$t('mark3.removeFile', { name: screenshot.name })" @click="removeMark3Screenshot(index)">×</button>
            </li>
          </ul>
          <p v-if="mark3ScreenshotErr" class="h100-err">{{ mark3ScreenshotErr }}</p>
        </div>

        <div class="h100-field">
          <span class="h100-field-label">{{ $t('mark3.replaysLabel') }}
            <span class="h100-counter">{{ $t('mark3.replayCounter', { current: mark3SubmitForm.replays.length }) }}</span>
          </span>
          <input ref="mark3ReplaysInput" type="file" accept=".wotbreplay" multiple @change="onMark3ReplaysChange" />
          <small>{{ $t('mark3.replaysHint') }}</small>
          <ul v-if="mark3SubmitForm.replays.length" class="h100-selected-files">
            <li v-for="(replay, index) in mark3SubmitForm.replays" :key="mark3ReplayFileKey(replay)" class="h100-selected-file">
              <span class="h100-file-index">{{ index + 1 }}</span>
              <span class="h100-selected-name" :title="replay.name">{{ replay.name }}</span>
              <button type="button" class="h100-remove-file" :aria-label="$t('mark3.removeFile', { name: replay.name })" @click="removeMark3Replay(index)">×</button>
            </li>
          </ul>
          <p v-if="mark3ReplayErr" class="h100-err">{{ mark3ReplayErr }}</p>
        </div>

        <p v-if="mark3NeedProfile" class="h100-need-profile">
          {{ mark3SubmitError }} <a href="/?view=profile">{{ $t('mark3.goProfile') }}</a>
        </p>
        <p v-else-if="mark3SubmitError" class="h100-err">{{ mark3SubmitError }}</p>

        <div class="modal-actions">
          <button type="button" class="ghost danger h100-clear-draft" :disabled="mark3Submitting || !mark3HasDraft" @click="clearMark3Draft">{{ $t('mark3.clearDraft') }}</button>
          <button type="button" class="ghost" :disabled="mark3Submitting" @click="closeMark3Submit">{{ $t('app.close') }}</button>
          <button type="button" class="filebtn mark3-modal-submit" :disabled="mark3Submitting || mark3ScreenshotsReading" @click="submitMark3">
            {{ mark3Submitting ? $t('mark3.submitting') : $t('mark3.submit') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lb-wrap { max-width: var(--wide-max, 1600px); margin: 0 auto; padding: 24px 20px 56px; }
.lb-head { margin: 0 0 14px; }
.lb-kicker { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 6px; background: var(--bg-rating); color: var(--accent-dark); font-size: 12px; font-weight: 800; }
.lb-head h1 { margin: 10px 0 6px; color: var(--text-heading); font-size: 1.7rem; line-height: 1.15; letter-spacing: 0; }
.lb-head p { margin: 0; color: var(--text-label); line-height: 1.65; }
.lb-toolbar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 14px;
  align-items: end; margin: 16px 0 12px; }
.lb-limit { font-size: 13px; color: var(--text-label); display: grid; gap: 4px; min-width: 0; }
.lb-limit .lb-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-limit select { border: 1px solid var(--border-ghost);
  background: var(--bg-card2); color: var(--text-label); padding: 5px 10px; border-radius: 7px;
  font-size: 13px; cursor: pointer; font-family: inherit; width: 100%; min-width: 0; }
.lb-nick-input { border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label);
  padding: 5px 10px; border-radius: 7px; font-size: 13px; font-family: inherit; width: 100%; min-width: 0; }
.lb-nick-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; min-width: 0; }
.lb-dmg { font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.lb-replay { white-space: nowrap; }
.bt-badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.bt-random { background: var(--rating-good-bg); color: var(--rating-good-fg); }
.bt-rating { background: var(--rating-great-bg); color: var(--rating-great-fg); }
.lb-download {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 26px; padding: 0;
  border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label);
  font-family: inherit; cursor: pointer;
}
.lb-download .ic { width: 15px; height: 15px; }
.lb-download:hover:not(:disabled) { background: var(--bg-card-hover); color: var(--accent); }
.lb-download:disabled { opacity: .55; cursor: not-allowed; }
.lb-no-replay { color: var(--text-muted); }
.lb-time { color: var(--text-muted); font-size: .9em; white-space: nowrap; }
.lb-version { color: var(--text-muted); font-size: .85em; }
.lb-tank-link {
  background: none; border: none; padding: 0; color: var(--accent); font-family: inherit;
  font-size: inherit; cursor: pointer; text-decoration: none;
}
.lb-tank-link:hover { text-decoration: underline; color: var(--accent-hover); background: var(--accent-shadow); border-radius: 3px; transition: all .12s; }
.lb-filter-hint { margin: 8px 0 10px; font-size: 13px; color: var(--text-label); }
.lb-filter-hint strong { color: var(--accent-dark); }
.rk { display: inline-block; min-width: 26px; padding: 1px 8px; border-radius: 6px; font-size: 12px;
  font-weight: 600; background: var(--bg-chip); color: var(--text-label); }
.rk-gold { background: var(--rating-good-bg); color: var(--rating-good-fg); }
.rk-silver { background: var(--bg-chip); color: var(--text-label); }
.rk-bronze { background: var(--rating-great-bg); color: var(--rating-great-fg); }
.muted { padding: 28px 4px; color: var(--text-muted); }

.lb-submit-row { display: flex; align-items: center; gap: 12px; margin: 14px 0 16px; flex-wrap: wrap; }
.lb-submit-row .lb-upload-msg { margin: 0; }
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.modal-head h2 { margin: 0; }
.modal-x { border: none; background: transparent; color: var(--text-sub); font-size: 1.4rem; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.modal-x:hover { background: var(--bg-card-hover); color: var(--text-heading); }
.hof-upload-modal { max-width: 560px; }
.hof-upload-modal .lb-upload-card { padding: 26px 18px; }
.lb-upload-section { margin: 16px 0; }
.lb-upload-card {
  position: relative;
  overflow: hidden;
  border: 1.5px dashed var(--border-dashed);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, transparent), transparent 48%),
    var(--bg-upload);
  border-radius: 8px;
  padding: 30px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: border-color .12s, background .12s, box-shadow .12s, transform .12s;
}
.lb-upload-card::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: .75;
}
.lb-upload-card.dragging { border-color: var(--accent); background: var(--bg-blue-light); box-shadow: 0 16px 36px var(--accent-shadow); transform: translateY(-1px); }
.lb-upload-card .up-title { max-width: 420px; margin-top: 10px; line-height: 1.25; }
.lb-upload-card .up-sub { max-width: 360px; margin-top: 8px; line-height: 1.5; }
.lb-upload-card .filebtn { margin-top: 18px; position: relative; z-index: 1; }
.lb-hidden-input { display: none; }
.lb-upload-card .filebtn.lb-uploading { opacity: .6; pointer-events: none; }
.lb-upload-msg { margin-top: 10px; font-size: 13px; text-align: center; }
.lb-upload-msg.err { color: var(--error); }
.pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px 0; font-size: .85rem; }
.pagination button { padding: 6px 14px; border: 1px solid var(--border-ghost); border-radius: 7px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font-family: inherit; font-size: .82rem; }
.pagination button:disabled { opacity: .4; cursor: not-allowed; }
.pagination button:hover:not(:disabled) { background: var(--bg-card-hover); }

/* ── 百场 Tab ─────────────────────────────────── */
.h100-vehicle-filter, .mark3-vehicle-filter { flex-wrap: wrap; }
.hof-vehicle-select, .h100-vehicle-select, .mark3-vehicle-select { min-width: 200px; }
.h100-pending-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin: 12px 0; padding: 12px 14px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-card); box-shadow: var(--surface-shadow);
}
.h100-pending-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.h100-pending-title { font-size: 13px; font-weight: 700; color: var(--accent-dark); }
.h100-pending-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--text-label); }
.h100-pending-meta strong { color: var(--accent-dark); font-variant-numeric: tabular-nums; }
.h100-pending-time { color: var(--text-muted); }
.h100-pending-card .ghost { margin-left: auto; }

/* 提交弹窗 */
.h100-draft-hint {
  margin: 8px 0 12px; padding: 8px 10px;
  border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-muted);
  font-size: 12px; line-height: 1.5;
}
.h100-submit-modes {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0;
}
.h100-mode {
  padding: 9px 12px; border: 1px solid var(--border-ghost); border-radius: 8px;
  background: var(--bg-card2); color: var(--text-label); cursor: pointer; font: inherit; font-weight: 650;
}
.h100-mode.active { border-color: var(--accent); background: var(--bg-rating); color: var(--accent-dark); }
.h100-mode:disabled { opacity: .5; cursor: not-allowed; }
.h100-wg-state {
  margin: 10px 0 14px; padding: 10px 12px; border: 1px solid var(--border-ghost); border-radius: 8px;
  background: var(--bg-card2); color: var(--text-label); font-size: 12px; line-height: 1.55;
}
.h100-wg-state strong { color: var(--text-heading); }
.h100-wg-state p { margin: 4px 0 0; }
.h100-wg-locked { border-color: color-mix(in srgb, var(--warn-text) 35%, var(--border-ghost)); }
.h100-wg-ready { border-color: color-mix(in srgb, var(--rating-good-fg) 35%, var(--border-ghost)); }
.h100-wg-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.h100-wg-actions .ghost { padding: 5px 10px; }
.h100-field { margin: 12px 0; }
.h100-field-label { display: block; font-size: 13px; color: var(--text-label); font-weight: 600; margin-bottom: 4px; }
.h100-field select, .h100-field input[type="number"] {
  border: 1px solid var(--border-ghost); background: var(--bg-card2); color: var(--text-label);
  padding: 6px 10px; border-radius: 7px; font-size: 13px; font-family: inherit; max-width: 100%;
}
.h100-field input[type="number"] { width: 170px; }
.h100-field small { display: block; color: var(--text-muted); font-size: 12px; margin-top: 3px; line-height: 1.5; }
.h100-field input[type="file"] { font-size: 12px; color: var(--text-label); margin-top: 2px; }
.h100-counter { font-size: 12px; font-weight: 700; color: var(--accent-dark); margin-left: 8px; }
.h100-file-reading { margin: 6px 0 0; color: var(--text-muted); font-size: 12px; }
.h100-selected-files { display: grid; gap: 5px; margin: 8px 0 0; padding: 0; list-style: none; }
.h100-selected-file {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  margin-top: 6px; padding: 6px 8px;
  border: 1px solid var(--border-ghost); border-radius: 7px;
  background: var(--bg-card2); color: var(--text-label); font-size: 12px;
}
.h100-selected-files .h100-selected-file { margin-top: 0; }
.mark3-proof-item { align-items: center; }
.mark3-proof-preview {
  width: 48px; height: 36px; flex: 0 0 auto; object-fit: cover;
  border: 1px solid var(--border-ghost); border-radius: 5px; background: var(--bg-card);
}
.h100-file-index {
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--bg-rating); color: var(--accent-dark); font-weight: 700;
}
.h100-selected-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.h100-remove-file {
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  width: 24px; height: 24px; padding: 0;
  border: 1px solid var(--border-ghost); border-radius: 6px;
  background: transparent; color: var(--error); cursor: pointer; font: inherit;
}
.h100-remove-file:hover { background: color-mix(in srgb, var(--error) 10%, transparent); }
.h100-clear-draft { margin-right: auto; }
.h100-err { color: var(--error); font-size: 13px; margin: 6px 0 0; }
.h100-need-profile { color: var(--error); font-size: 13px; margin: 8px 0 0; line-height: 1.6; }
.h100-need-profile a { color: var(--accent); font-weight: 600; }

@media (max-width: 560px) {
  .lb-wrap { padding: 14px 12px 48px; }
  .lb-head h1 { font-size: 1.55rem; }
  .lb-upload-card { min-height: 230px; padding: 28px 16px; }
  .lb-upload-card .up-title { max-width: 260px; }
  .lb-upload-card .up-sub { max-width: 240px; }
}
</style>
