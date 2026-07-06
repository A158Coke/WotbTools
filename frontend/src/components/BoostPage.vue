<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import {
  adminBoostAssign,
  adminBoostBoosterApplicationApprove,
  adminBoostBoosterApplicationReject,
  adminBoostBoosterApplicationReviewing,
  adminBoostBoosterApplications,
  adminBoostBoosterAvailability,
  adminBoostBoosterCreate,
  adminBoostBoosterDelete,
  adminBoostBoosterList,
  adminBoostBoosterUpdate,
  adminBoostRequests,
  adminBoostUnassign,
  adminBoostUpdateStatus,
  adminSearchUsers,
  boostCancelRequest,
  boostCreateBoosterApplication,
  boostCreateRequest,
  boostListMyBoosterApplications,
  boostListMyRequests,
  boostOptions,
  createUserProfile,
  getMyBoosterAssignments,
  getMyBoosterProfile,
  getUserProfile
} from '../utils/api-boost.js'

const { t } = useI18n()
const { initPromise, login, isAuthenticated, userName, tokenParsed } = useAuth()

// Auth gate
const phase = ref('init')
const user = ref('')

// Tabs
const tab = ref('request')

// Options (dropdown data)
const options = ref({ regions: [], requestTypes: [], contactTypes: [], warning: '' })
const imageMaxBytes = 4 * 1024 * 1024
const boosterLevels = ['CASUAL', 'SKILLED', 'ELITE', 'PRO']
const boosterLevelRank = { CASUAL: 1, SKILLED: 2, ELITE: 3, PRO: 4 }
const availabilityTiers = ['YEAR_360', 'QUARTER_80', 'MONTH_20', 'WEEK_5', 'WEEK_4', 'WEEK_3', 'WEEK_1']

// Form
const form = ref({ region: 'CN', requestType: 'COACHING', contactType: 'QQ', targetDescription: '', contactValue: '', playerNickname: '', playerAccountId: null, budgetRange: '', availableTime: '', remark: '' })
const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')

// My requests
const myRequests = ref([])
const loadingMy = ref(false)

// Booster application
const profile = ref(null)
const myBooster = ref(null)
const myApplications = ref([])
const loadingApplications = ref(false)
const applicationForm = ref({
  wotbAccountId: null,
  wotbNickname: '',
  wotbServer: 'CN',
  overallStatsImage: '',
  vehicleStatsImage: '',
  requestedLevel: 'SKILLED',
  qq: '',
  wechat: '',
  availabilityTier: 'MONTH_20',
  dailyTimeWindow: '',
  selfAssessment: ''
})
const imageNames = ref({ overall: '', vehicle: '' })
const applicationSubmitting = ref(false)
const applicationError = ref('')
const applicationSuccess = ref('')
const isBooster = computed(() => !!myBooster.value)
const boundWotbAccount = computed(() => !!profile.value?.wotbAccountId && !!String(profile.value?.wotbNickname || '').trim())
const myAssignments = ref([])
const loadingAssignments = ref(false)

// Admin: 检查 realm 角色 + 客户端角色 (resource_access)
const isAdmin = computed(() => {
  const tp = tokenParsed.value
  if (!tp) return false
  const roles = [
    ...(tp.realm_access?.roles || []),
    ...(tp.resource_access?.['wotbtools-web']?.roles || [])
  ]
  return roles.includes('wotbtools-admin') || roles.includes('boost-manager')
})

// Admin: request list
const adminRequests = ref([])
const adminPage = ref({ page: 0, size: 20, totalElements: 0, totalPages: 0 })
const adminStatusFilter = ref('')
const loadingAdmin = ref(false)

// Admin: booster applications
const adminApplications = ref([])
const applicationPage = ref({ page: 0, size: 20, totalElements: 0, totalPages: 0 })
const applicationStatusFilter = ref('')
const loadingAdminApplications = ref(false)
const applicationNotes = ref({})

// Admin: booster list
const boosters = ref([])
const boosterPage = ref({ page: 0, size: 20 })
const loadingBoosters = ref(false)
const editingBooster = ref(null)
const boosterForm = ref({ nickname: '', level: 'ELITE', keycloakUserId: '', available: true, status: 'ACTIVE', contactType: '', contactValue: '', specialties: '', description: '' })
const boosterError = ref('')

// Admin: user search
const allUsers = ref([])
const userSearchQuery = ref('')
const userSearchResults = ref([])
const showUserSearch = ref(false)
let searchTimer = null

async function loadAllUsers() {
  try {
    const res = await adminSearchUsers('', 200)
    allUsers.value = res.content || res || []
  } catch { allUsers.value = [] }
}

function searchUsers() {
  if (!userSearchQuery.value.trim()) {
    userSearchResults.value = allUsers.value.slice(0, 30)
    showUserSearch.value = true
    return
  }
  clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    try {
      const res = await adminSearchUsers(userSearchQuery.value.trim(), 10)
      userSearchResults.value = (res.content || res).slice(0, 10)
      showUserSearch.value = true
    } catch {
      userSearchResults.value = []
    }
  }, 300)
}

function selectUser(user) {
  boosterForm.value.keycloakUserId = user.keycloakUserId || user.id
  const displayName = user.displayName || user.keycloakUsername || 'User'
  boosterForm.value.nickname = displayName
  userSearchQuery.value = displayName
  showUserSearch.value = false
}

async function deleteBooster(b) {
  if (!confirm(t('boost.deleteBoosterConfirm', { name: b.nickname }))) return
  try {
    await adminBoostBoosterDelete(b.id)
    loadBoosters(boosterPage.value.page)
  } catch (e) { alert(e.message) }
}

// Admin: assignment
const assigningRequest = ref(null)
const assignBoosterId = ref(null)
const assignNote = ref('')
const assignError = ref('')

onMounted(async () => {
  try {
    const loggedIn = await initPromise
    if (loggedIn || isAuthenticated()) {
      user.value = userName() || ''
      phase.value = 'done'
      loadOptions()
      loadMyRequests()
      loadApplicantState()
    } else {
      phase.value = 'login'
      login()
    }
  } catch {
    phase.value = 'error'
  }
})

async function loadOptions() {
  try { options.value = await boostOptions() } catch {}
}

async function loadMyRequests() {
  loadingMy.value = true
  try { myRequests.value = await boostListMyRequests() } catch { myRequests.value = [] }
  finally { loadingMy.value = false }
}

async function loadApplicantState() {
  try {
    profile.value = await getUserProfile()
  } catch {
    try { profile.value = await createUserProfile() } catch { profile.value = null }
  }
  applyBoundAccount()
  try { myBooster.value = await getMyBoosterProfile() } catch { myBooster.value = null }
  if (isBooster.value && tab.value === 'apply') tab.value = 'request'
  if (isBooster.value) await loadMyAssignments()
  await loadMyApplications()
}

async function loadMyAssignments() {
  loadingAssignments.value = true
  try { myAssignments.value = await getMyBoosterAssignments() } catch { myAssignments.value = [] }
  finally { loadingAssignments.value = false }
}

function applyBoundAccount() {
  if (!profile.value?.wotbAccountId) return
  applicationForm.value.wotbAccountId = profile.value.wotbAccountId
  applicationForm.value.wotbNickname = profile.value.wotbNickname || ''
  applicationForm.value.wotbServer = profile.value.wotbServer || 'CN'
}

async function loadMyApplications() {
  loadingApplications.value = true
  try { myApplications.value = await boostListMyBoosterApplications() } catch { myApplications.value = [] }
  finally { loadingApplications.value = false }
}

function applicationLevelLabel(level) {
  return t(`boost.level.${level || 'SKILLED'}`)
}

function availabilityLabel(tier) {
  return t(`boost.availability.${tier || 'MONTH_20'}`)
}

function boosterAvailabilityState(booster) {
  if (!booster?.available) return 'paused'
  return (booster.activeAssignmentCount || 0) > 0 ? 'busy' : 'available'
}

function boosterAvailabilityLabel(booster) {
  return t(`boost.boosterAvailabilityState.${boosterAvailabilityState(booster)}`)
}

function boosterAvailabilityBadge(booster) {
  return boosterAvailabilityState(booster) === 'available' ? 'ok' : 'warn'
}

function boosterAvailabilityActionLabel(available) {
  return available ? t('boost.setUnavailable') : t('boost.setAvailable')
}

function boosterAssignable(booster) {
  return booster?.status === 'ACTIVE' && boosterAvailabilityState(booster) === 'available'
}

function boosterPickerSuffix(booster) {
  const tags = []
  if (booster?.status && booster.status !== 'ACTIVE') tags.push(booster.statusLabel)
  if (boosterAvailabilityState(booster) !== 'available') tags.push(boosterAvailabilityLabel(booster))
  return tags.length ? ` [${tags.join(' / ')}]` : ''
}

function recommendedBoosters(request) {
  return [...boosters.value].sort((a, b) => boosterMatchScore(b, request) - boosterMatchScore(a, request)
    || (a.activeAssignmentCount || 0) - (b.activeAssignmentCount || 0)
    || (boosterLevelRank[b.level] || 0) - (boosterLevelRank[a.level] || 0)
    || String(a.nickname || '').localeCompare(String(b.nickname || '')))
}

function boosterMatchScore(booster, request) {
  const text = `${request?.requestTypeLabel || ''} ${request?.targetDescription || ''}`.toLowerCase()
  const profile = `${booster?.specialties || ''} ${booster?.description || ''} ${booster?.levelLabel || ''}`.toLowerCase()
  let score = 0
  if (boosterAssignable(booster)) score += 1000
  if (booster?.status === 'ACTIVE') score += 100
  if (booster?.available) score += 80
  score -= (booster?.activeAssignmentCount || 0) * 200
  score += (boosterLevelRank[booster?.level] || 0) * 10
  if (profile && text && profile.split(/\s+/).some(part => part.length >= 2 && text.includes(part))) score += 60
  return score
}

function isRecommendedBooster(booster, request) {
  return recommendedBoosters(request).find(boosterAssignable)?.id === booster?.id
}

function applicationStatusLabel(status) {
  return t(`boost.applicationStatus.${status || 'NEW'}`)
}

function latestOpenApplication() {
  return myApplications.value.find(a => a.status === 'NEW' || a.status === 'REVIEWING')
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(''); return }
    if (!file.type?.startsWith('image/')) {
      reject(new Error(t('boost.applicationImageTypeError')))
      return
    }
    if (file.size > imageMaxBytes) {
      reject(new Error(t('boost.applicationImageSizeError')))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(t('boost.applicationImageReadError')))
    reader.readAsDataURL(file)
  })
}

async function selectApplicationImage(kind, event) {
  applicationError.value = ''
  const file = event.target.files?.[0]
  try {
    const dataUrl = await readImage(file)
    if (kind === 'overall') {
      applicationForm.value.overallStatsImage = dataUrl
      imageNames.value.overall = file?.name || ''
    } else {
      applicationForm.value.vehicleStatsImage = dataUrl
      imageNames.value.vehicle = file?.name || ''
    }
  } catch (e) {
    applicationError.value = e.message
    event.target.value = ''
  }
}

async function submitBoosterApplication() {
  applicationError.value = ''
  applicationSuccess.value = ''
  applyBoundAccount()
  const f = applicationForm.value
  if (!f.wotbAccountId || !String(f.wotbNickname || '').trim() || !f.qq.trim() || !f.dailyTimeWindow.trim() || !f.overallStatsImage || !f.vehicleStatsImage) {
    applicationError.value = t('boost.applicationFillRequired')
    return
  }
  applicationSubmitting.value = true
  try {
    await boostCreateBoosterApplication(f)
    applicationSuccess.value = t('boost.applicationSubmitted')
    f.overallStatsImage = ''
    f.vehicleStatsImage = ''
    f.selfAssessment = ''
    imageNames.value = { overall: '', vehicle: '' }
    await loadMyApplications()
  } catch (e) {
    applicationError.value = e.message
  } finally {
    applicationSubmitting.value = false
  }
}

async function submitRequest() {
  formError.value = ''
  formSuccess.value = ''
  if (!form.value.targetDescription.trim() || !form.value.contactValue.trim()) {
    formError.value = t('boost.fillRequired')
    return
  }
  submitting.value = true
  try {
    const res = await boostCreateRequest(form.value)
    formSuccess.value = res.message || t('boost.submitted')
    form.value.targetDescription = ''
    form.value.contactValue = ''
    form.value.remark = ''
    loadMyRequests()
  } catch (e) {
    formError.value = e.message
  }
  finally { submitting.value = false }
}

async function cancelRequest(id) {
  try {
    await boostCancelRequest(id)
    loadMyRequests()
  } catch (e) {
    alert(e.message)
  }
}

// Admin functions
async function loadAdminRequests(page = 0) {
  loadingAdmin.value = true
  try {
    const params = { page, size: adminPage.value.size }
    if (adminStatusFilter.value) params.status = adminStatusFilter.value
    const data = await adminBoostRequests(params)
    adminRequests.value = data.content || []
    adminPage.value = { page: data.page, size: data.size, totalElements: data.totalElements, totalPages: data.totalPages }
  } catch { adminRequests.value = [] }
  finally { loadingAdmin.value = false }
}

async function updateStatus(id, status) {
  try {
    await adminBoostUpdateStatus(id, { status, adminNote: '' })
    loadAdminRequests(adminPage.value.page)
    loadBoosters(boosterPage.value.page)
  } catch (e) { alert(e.message) }
}

async function loadAdminApplications(page = 0) {
  loadingAdminApplications.value = true
  try {
    const params = { page, size: applicationPage.value.size }
    if (applicationStatusFilter.value) params.status = applicationStatusFilter.value
    const data = await adminBoostBoosterApplications(params)
    adminApplications.value = data.content || []
    applicationPage.value = { page: data.page, size: data.size, totalElements: data.totalElements, totalPages: data.totalPages }
  } catch { adminApplications.value = [] }
  finally { loadingAdminApplications.value = false }
}

async function reviewApplication(id) {
  try {
    await adminBoostBoosterApplicationReviewing(id, { adminNote: applicationNotes.value[id] || '' })
    loadAdminApplications(applicationPage.value.page)
  } catch (e) { alert(e.message) }
}

async function approveApplication(id) {
  if (!confirm(t('boost.applicationApproveConfirm'))) return
  try {
    await adminBoostBoosterApplicationApprove(id, { adminNote: applicationNotes.value[id] || '' })
    loadAdminApplications(applicationPage.value.page)
    loadBoosters(boosterPage.value.page)
  } catch (e) { alert(e.message) }
}

async function rejectApplication(id) {
  if (!confirm(t('boost.applicationRejectConfirm'))) return
  try {
    await adminBoostBoosterApplicationReject(id, { adminNote: applicationNotes.value[id] || '' })
    loadAdminApplications(applicationPage.value.page)
  } catch (e) { alert(e.message) }
}

async function assignBooster(id) {
  assignError.value = ''
  try {
    await adminBoostAssign(id, { boosterId: assignBoosterId.value, note: assignNote.value })
    assigningRequest.value = null
    assignBoosterId.value = null
    assignNote.value = ''
    loadAdminRequests(adminPage.value.page)
    loadBoosters(boosterPage.value.page)
  } catch (e) { assignError.value = e.message }
}

async function unassignBooster(id) {
  try {
    await adminBoostUnassign(id, { note: '' })
    loadAdminRequests(adminPage.value.page)
    loadBoosters(boosterPage.value.page)
  } catch (e) { alert(e.message) }
}

async function loadBoosters(page = 0) {
  loadingBoosters.value = true
  try {
    const data = await adminBoostBoosterList({ page, size: boosterPage.value.size })
    boosters.value = data.content || []
    boosterPage.value = { page: data.page, size: data.size, totalElements: data.totalElements, totalPages: data.totalPages }
  } catch { boosters.value = [] }
  finally { loadingBoosters.value = false }
}

function startNewBooster() {
  editingBooster.value = {}
  boosterForm.value = { nickname: '', level: 'ELITE', keycloakUserId: '', available: true, status: 'ACTIVE', contactType: '', contactValue: '', specialties: '', description: '' }
  userSearchQuery.value = ''
  userSearchResults.value = allUsers.value.slice(0, 30)
  showUserSearch.value = true
  boosterError.value = ''
}

function startEditBooster(b) {
  editingBooster.value = b
  boosterForm.value = { nickname: b.nickname || '', level: b.level || 'ELITE', keycloakUserId: b.keycloakUserId || '', available: b.available, status: b.status || 'ACTIVE', contactType: b.contactType || '', contactValue: b.contactValue || '', specialties: b.specialties || '', description: b.description || '' }
  userSearchQuery.value = b.keycloakUserId || ''
  userSearchResults.value = []
  showUserSearch.value = false
  boosterError.value = ''
}

function cancelEditBooster() {
  editingBooster.value = null
}

async function saveBooster() {
  boosterError.value = ''
  try {
    if (editingBooster.value?.id) {
      await adminBoostBoosterUpdate(editingBooster.value.id, boosterForm.value)
    } else {
      await adminBoostBoosterCreate(boosterForm.value)
    }
    editingBooster.value = null
    loadBoosters(boosterPage.value.page)
  } catch (e) { boosterError.value = e.message }
}

async function toggleBoosterAvailable(b) {
  try {
    await adminBoostBoosterAvailability(b.id, { available: !b.available })
    loadBoosters(boosterPage.value.page)
  } catch (e) { alert(e.message) }
}

function statusBadge(s) {
  const map = { NEW: 'info', REVIEWING: 'warn', APPROVED: 'ok', MATCHED: 'ok', CLOSED: 'ok', REJECTED: 'err', CANCELLED: 'err', ASSIGNED: 'ok', ACTIVE: 'ok', INACTIVE: 'warn', BANNED: 'err' }
  return map[s] || ''
}

function switchTab(t) {
  if (t === 'apply' && isBooster.value) return
  tab.value = t
  if (t === 'adminRequests') { loadAdminRequests(); loadBoosters() }
  else if (t === 'boosters') { loadBoosters(); loadAllUsers() }
  else if (t === 'apply') { loadApplicantState() }
  else if (t === 'myAssignments') { loadMyAssignments() }
  else if (t === 'applicationReview') { loadAdminApplications(); loadBoosters() }
}
</script>

<template>
  <div class="boost-page" v-if="phase === 'done'">
    <!-- Tabs -->
    <div class="boost-tabs">
      <button :class="{ active: tab === 'request' }" @click="switchTab('request')">{{ $t('boost.submitTab') }}</button>
      <button :class="{ active: tab === 'my' }" @click="switchTab('my')">{{ $t('boost.myTab') }}</button>
      <button v-if="isBooster" :class="{ active: tab === 'myAssignments' }" @click="switchTab('myAssignments')">{{ $t('boost.myAssignmentsTab') }}</button>
      <button v-if="!isBooster" :class="{ active: tab === 'apply' }" @click="switchTab('apply')">{{ $t('boost.applyBoosterTab') }}</button>
      <template v-if="isAdmin">
        <button :class="{ active: tab === 'adminRequests' }" @click="switchTab('adminRequests')">{{ $t('boost.adminRequestsTab') }}</button>
        <button :class="{ active: tab === 'applicationReview' }" @click="switchTab('applicationReview')">{{ $t('boost.applicationReviewTab') }}</button>
        <button :class="{ active: tab === 'boosters' }" @click="switchTab('boosters')">{{ $t('boost.boostersTab') }}</button>
      </template>
    </div>

    <!-- Tab: Submit Request -->
    <div v-if="tab === 'request'" class="boost-card">
      <h3 class="card-title">{{ $t('boost.submitTitle') }}</h3>
      <p class="boost-warning">{{ options.warning }}</p>

      <div class="boost-form">
        <div class="form-row">
          <label>{{ $t('boost.region') }}</label>
          <select v-model="form.region">
            <option v-for="o in options.regions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.requestType') }}</label>
          <select v-model="form.requestType">
            <option v-for="o in options.requestTypes" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.playerNickname') }}</label>
          <input v-model="form.playerNickname" maxlength="100" :placeholder="$t('boost.playerNicknameHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.playerAccountId') }}</label>
          <input v-model.number="form.playerAccountId" type="number" :placeholder="$t('boost.playerAccountIdHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.targetDescription') }} *</label>
          <textarea v-model="form.targetDescription" rows="4" maxlength="2000" :placeholder="$t('boost.targetHint')"></textarea>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.contactType') }}</label>
          <select v-model="form.contactType">
            <option v-for="o in options.contactTypes" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.contactValue') }} *</label>
          <input v-model="form.contactValue" maxlength="255" :placeholder="$t('boost.contactHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.budgetRange') }}</label>
          <input v-model="form.budgetRange" maxlength="64" :placeholder="$t('boost.budgetHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.availableTime') }}</label>
          <input v-model="form.availableTime" maxlength="255" :placeholder="$t('boost.timeHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.remark') }}</label>
          <textarea v-model="form.remark" rows="2" maxlength="500" :placeholder="$t('boost.remarkHint')"></textarea>
        </div>

        <div v-if="formError" class="boost-error">{{ formError }}</div>
        <div v-if="formSuccess" class="boost-success">{{ formSuccess }}</div>

        <button class="btn-primary" @click="submitRequest" :disabled="submitting">
          {{ submitting ? $t('boost.submitting') : $t('boost.submit') }}
        </button>
      </div>
    </div>

    <!-- Tab: Apply Booster -->
    <div v-if="tab === 'apply' && !isBooster" class="boost-card">
      <h3 class="card-title">{{ $t('boost.applyBoosterTitle') }}</h3>
      <p class="boost-warning">{{ $t('boost.applyBoosterWarning') }}</p>

      <div v-if="latestOpenApplication()" class="boost-success">
        {{ $t('boost.applicationOpenHint', { status: applicationStatusLabel(latestOpenApplication().status) }) }}
      </div>

      <div class="boost-form">
        <div class="form-row">
          <label>{{ $t('boost.playerNickname') }} *</label>
          <input v-model="applicationForm.wotbNickname" maxlength="100" :disabled="boundWotbAccount" :placeholder="$t('boost.applicationNicknameHint')" />
          <small v-if="boundWotbAccount" class="field-hint">{{ $t('boost.applicationBoundHint') }}</small>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.playerAccountId') }} *</label>
          <input v-model.number="applicationForm.wotbAccountId" type="number" :disabled="boundWotbAccount" :placeholder="$t('boost.applicationAccountIdHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.applicationLevel') }} *</label>
          <select v-model="applicationForm.requestedLevel">
            <option v-for="level in boosterLevels" :key="level" :value="level">{{ applicationLevelLabel(level) }}</option>
          </select>
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label>{{ $t('boost.applicationOverallImage') }} *</label>
            <input type="file" accept="image/*" @change="selectApplicationImage('overall', $event)" />
            <small class="field-hint">{{ imageNames.overall || $t('boost.applicationImageHint') }}</small>
          </div>
          <div class="form-row">
            <label>{{ $t('boost.applicationVehicleImage') }} *</label>
            <input type="file" accept="image/*" @change="selectApplicationImage('vehicle', $event)" />
            <small class="field-hint">{{ imageNames.vehicle || $t('boost.applicationImageHint') }}</small>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label>{{ $t('boost.applicationQq') }} *</label>
            <input v-model="applicationForm.qq" maxlength="64" :placeholder="$t('boost.applicationQqHint')" />
          </div>
          <div class="form-row">
            <label>{{ $t('boost.applicationWechat') }}</label>
            <input v-model="applicationForm.wechat" maxlength="64" :placeholder="$t('boost.applicationWechatHint')" />
          </div>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.applicationAvailability') }} *</label>
          <select v-model="applicationForm.availabilityTier">
            <option v-for="tier in availabilityTiers" :key="tier" :value="tier">{{ availabilityLabel(tier) }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.applicationDailyTime') }} *</label>
          <input v-model="applicationForm.dailyTimeWindow" maxlength="255" :placeholder="$t('boost.applicationDailyTimeHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.applicationSelfAssessment') }}</label>
          <textarea v-model="applicationForm.selfAssessment" rows="3" maxlength="2000" :placeholder="$t('boost.applicationSelfAssessmentHint')"></textarea>
        </div>

        <div v-if="applicationError" class="boost-error">{{ applicationError }}</div>
        <div v-if="applicationSuccess" class="boost-success">{{ applicationSuccess }}</div>

        <button class="btn-primary" @click="submitBoosterApplication" :disabled="applicationSubmitting || !!latestOpenApplication()">
          {{ applicationSubmitting ? $t('boost.submitting') : $t('boost.applyBoosterSubmit') }}
        </button>
      </div>

      <div class="application-history">
        <h4>{{ $t('boost.myBoosterApplications') }}</h4>
        <div v-if="loadingApplications" class="boost-loading">{{ $t('boost.loading') }}</div>
        <div v-else-if="!myApplications.length" class="boost-empty">{{ $t('boost.noBoosterApplications') }}</div>
        <div v-else class="my-list">
          <div v-for="a in myApplications" :key="a.id" class="my-item">
            <div class="my-header">
              <strong>#{{ a.id }}</strong>
              <span>{{ applicationLevelLabel(a.requestedLevel) }}</span>
              <span :class="'badge badge-' + statusBadge(a.status)">{{ applicationStatusLabel(a.status) }}</span>
              <span class="my-time">{{ new Date(a.createdAt).toLocaleString() }}</span>
            </div>
            <div class="my-meta">
              <span>{{ a.wotbNickname }} / {{ a.wotbAccountId }}</span>
              <span>{{ availabilityLabel(a.availabilityTier) }}</span>
            </div>
            <p v-if="a.adminNote" class="my-desc">{{ a.adminNote }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab: My Requests -->
    <div v-if="tab === 'my'" class="boost-card">
      <h3 class="card-title">{{ $t('boost.myRequests') }}</h3>
      <div v-if="loadingMy" class="boost-loading">{{ $t('boost.loading') }}</div>
      <div v-else-if="!myRequests.length" class="boost-empty">{{ $t('boost.noRequests') }}</div>
      <div v-else class="my-list">
        <div v-for="r in myRequests" :key="r.id" class="my-item">
          <div class="my-header">
            <span class="my-type">{{ r.requestTypeLabel }}</span>
            <span :class="'badge badge-' + statusBadge(r.status)">{{ r.statusLabel }}</span>
            <span class="my-time">{{ new Date(r.createdAt).toLocaleString() }}</span>
          </div>
          <p class="my-desc">{{ r.targetDescription }}</p>
          <div class="my-meta">
            <span>{{ $t('boost.contact') }}: {{ r.contactValueMasked }}</span>
            <span v-if="r.assigned" class="my-assigned">✓ {{ $t('boost.assigned') }}</span>
          </div>
          <div v-if="r.status === 'NEW' || r.status === 'REVIEWING'" class="my-actions">
            <button class="btn-ghost btn-sm" @click="cancelRequest(r.id)">{{ $t('boost.cancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab: My Booster Assignments -->
    <div v-if="isBooster && tab === 'myAssignments'" class="boost-card">
      <div class="flex-between">
        <h3 class="card-title">{{ $t('boost.myBoosterAssignments') }}</h3>
        <button class="btn-ghost btn-sm" @click="loadMyAssignments()">{{ $t('boost.refresh') }}</button>
      </div>
      <div v-if="loadingAssignments" class="boost-loading">{{ $t('boost.loading') }}</div>
      <div v-else-if="!myAssignments.length" class="boost-empty">{{ $t('boost.noAssignments') }}</div>
      <div v-else class="my-list">
        <div v-for="a in myAssignments" :key="a.id" class="my-item">
          <div class="my-header">
            <strong>#{{ a.requestId }}</strong>
            <span>{{ a.requestTypeLabel }}</span>
            <span :class="'badge badge-' + statusBadge(a.requestStatus)">{{ a.requestStatusLabel }}</span>
            <span class="my-time">{{ new Date(a.assignedAt).toLocaleString() }}</span>
          </div>
          <p class="my-desc">{{ a.targetDescription }}</p>
          <div class="my-meta">
            <span>{{ $t('boost.contact') }}: {{ a.contactValue }}</span>
            <span v-if="a.playerNickname">{{ $t('boost.playerNickname') }}: {{ a.playerNickname }}</span>
            <span v-if="a.playerAccountId">{{ $t('boost.playerAccountId') }}: {{ a.playerAccountId }}</span>
            <span v-if="a.availableTime">{{ $t('boost.availableTime') }}: {{ a.availableTime }}</span>
          </div>
          <p v-if="a.note" class="my-desc">{{ a.note }}</p>
        </div>
      </div>
    </div>

    <!-- Tab: Admin Requests -->
    <div v-if="isAdmin && tab === 'adminRequests'" class="boost-card">
      <h3 class="card-title">{{ $t('boost.adminRequests') }}</h3>
      <div class="admin-filters">
        <select v-model="adminStatusFilter" @change="loadAdminRequests()">
          <option value="">{{ $t('boost.allStatus') }}</option>
          <option value="NEW">{{ $t('boost.status.NEW') }}</option>
          <option value="REVIEWING">{{ $t('boost.status.REVIEWING') }}</option>
          <option value="MATCHED">{{ $t('boost.status.MATCHED') }}</option>
          <option value="CLOSED">{{ $t('boost.status.CLOSED') }}</option>
          <option value="REJECTED">{{ $t('boost.status.REJECTED') }}</option>
          <option value="CANCELLED">{{ $t('boost.status.CANCELLED') }}</option>
        </select>
        <span class="admin-count">{{ adminPage.totalElements }} {{ $t('boost.total') }}</span>
      </div>
      <div v-if="loadingAdmin" class="boost-loading">{{ $t('boost.loading') }}</div>
      <div v-else-if="!adminRequests.length" class="boost-empty">{{ $t('boost.noRequests') }}</div>
      <div v-else class="admin-list">
        <div v-for="r in adminRequests" :key="r.id" class="admin-item">
          <div class="admin-header">
            <strong>#{{ r.id }}</strong>
            <span>{{ r.requestTypeLabel }}</span>
            <span :class="'badge badge-' + statusBadge(r.status)">{{ r.statusLabel }}</span>
            <span class="admin-player">{{ r.playerNickname || r.contactValue }}</span>
            <span class="admin-time">{{ new Date(r.createdAt).toLocaleString() }}</span>
          </div>
          <p class="admin-desc">{{ r.targetDescription }}</p>
          <div class="admin-meta">
            <span>{{ $t('boost.contact') }}: {{ r.contactValue }}</span>
            <span v-if="r.currentAssignment">
              → {{ r.currentAssignment.booster.nickname }} ({{ r.currentAssignment.statusLabel }})
            </span>
          </div>
          <div class="admin-actions">
            <!-- Status updates -->
            <template v-if="r.status === 'NEW'">
              <button class="btn-ghost btn-sm" @click="updateStatus(r.id, 'REVIEWING')">{{ $t('boost.action.REVIEWING') }}</button>
              <button class="btn-ghost btn-sm" @click="updateStatus(r.id, 'REJECTED')">{{ $t('boost.action.REJECTED') }}</button>
            </template>
            <template v-if="r.status === 'REVIEWING'">
              <button class="btn-ghost btn-sm" @click="updateStatus(r.id, 'REJECTED')">{{ $t('boost.action.REJECTED') }}</button>
              <button class="btn-ghost btn-sm" @click="updateStatus(r.id, 'CANCELLED')">{{ $t('boost.action.CANCELLED') }}</button>
            </template>
            <template v-if="r.status === 'MATCHED'">
              <button class="btn-ghost btn-sm" @click="updateStatus(r.id, 'CLOSED')">{{ $t('boost.action.CLOSED') }}</button>
            </template>

            <!-- Assignment: 仅 REVIEWING 且无活跃分配时显示 -->
            <template v-if="!r.currentAssignment && (r.status === 'REVIEWING' || r.status === 'MATCHED' || r.status === 'NEW')">
              <button class="btn-primary btn-sm" @click="assigningRequest = r; assignBoosterId = null; assignNote = ''; assignError = ''">
                {{ $t('boost.assign') }}
              </button>
            </template>
            <!-- Unassign: 仅 MATCHED/REVIEWING 且存在活跃分配时显示 -->
            <template v-else-if="r.status === 'MATCHED' || r.status === 'REVIEWING'">
              <button class="btn-ghost btn-sm" @click="unassignBooster(r.id)">{{ $t('boost.unassign') }}</button>
            </template>
          </div>

          <!-- Assign modal inline -->
          <div v-if="assigningRequest === r" class="assign-box">
            <select v-model.number="assignBoosterId" class="mr">
              <option :value="null" disabled>{{ $t('boost.selectBooster') }}</option>
              <option v-for="b in recommendedBoosters(r)" :key="b.id" :value="b.id" :disabled="!boosterAssignable(b)">
                {{ isRecommendedBooster(b, r) ? '[' + $t('boost.recommended') + '] ' : '' }}{{ b.nickname }} ({{ b.levelLabel }}){{ boosterPickerSuffix(b) }}
              </option>
            </select>
            <input v-model="assignNote" :placeholder="$t('boost.assignNote')" class="mr" />
            <button class="btn-primary btn-sm" @click="assignBooster(r.id)" :disabled="!assignBoosterId">{{ $t('boost.confirm') }}</button>
            <button class="btn-ghost btn-sm" @click="assigningRequest = null">{{ $t('boost.cancel') }}</button>
            <div v-if="assignError" class="boost-error">{{ assignError }}</div>
            <div v-if="!boosters.length" class="boost-hint">{{ $t('boost.noBoostersHint') }}</div>
          </div>
        </div>
      </div>
      <div v-if="adminPage.totalPages > 1" class="pager">
        <button :disabled="adminPage.page <= 0" @click="loadAdminRequests(adminPage.page - 1)">←</button>
        <span>{{ adminPage.page + 1 }} / {{ adminPage.totalPages }}</span>
        <button :disabled="adminPage.page >= adminPage.totalPages - 1" @click="loadAdminRequests(adminPage.page + 1)">→</button>
      </div>
    </div>

    <!-- Tab: Booster Application Review -->
    <div v-if="isAdmin && tab === 'applicationReview'" class="boost-card">
      <h3 class="card-title">{{ $t('boost.applicationReviewTitle') }}</h3>
      <div class="admin-filters">
        <select v-model="applicationStatusFilter" @change="loadAdminApplications()">
          <option value="">{{ $t('boost.allStatus') }}</option>
          <option value="NEW">{{ $t('boost.applicationStatus.NEW') }}</option>
          <option value="REVIEWING">{{ $t('boost.applicationStatus.REVIEWING') }}</option>
          <option value="APPROVED">{{ $t('boost.applicationStatus.APPROVED') }}</option>
          <option value="REJECTED">{{ $t('boost.applicationStatus.REJECTED') }}</option>
        </select>
        <span class="admin-count">{{ applicationPage.totalElements }} {{ $t('boost.total') }}</span>
      </div>

      <div v-if="loadingAdminApplications" class="boost-loading">{{ $t('boost.loading') }}</div>
      <div v-else-if="!adminApplications.length" class="boost-empty">{{ $t('boost.noBoosterApplications') }}</div>
      <div v-else class="application-list">
        <div v-for="a in adminApplications" :key="a.id" class="application-item">
          <div class="admin-header">
            <strong>#{{ a.id }}</strong>
            <span>{{ a.wotbNickname }} / {{ a.wotbAccountId }}</span>
            <span>{{ applicationLevelLabel(a.requestedLevel) }}</span>
            <span :class="'badge badge-' + statusBadge(a.status)">{{ applicationStatusLabel(a.status) }}</span>
            <span class="admin-time">{{ new Date(a.createdAt).toLocaleString() }}</span>
          </div>
          <div class="application-details">
            <div><span>{{ $t('boost.applicationQq') }}</span><strong>{{ a.qq }}</strong></div>
            <div><span>{{ $t('boost.applicationWechat') }}</span><strong>{{ a.wechat || '-' }}</strong></div>
            <div><span>{{ $t('boost.applicationAvailability') }}</span><strong>{{ availabilityLabel(a.availabilityTier) }}</strong></div>
            <div><span>{{ $t('boost.applicationDailyTime') }}</span><strong>{{ a.dailyTimeWindow }}</strong></div>
            <div><span>{{ $t('boost.applicationSelfAssessment') }}</span><strong>{{ a.selfAssessment || '-' }}</strong></div>
          </div>
          <div class="application-images">
            <a :href="a.overallStatsImage" target="_blank" rel="noopener">
              <img :src="a.overallStatsImage" :alt="$t('boost.applicationOverallImage')" />
              <span>{{ $t('boost.applicationOverallImage') }}</span>
            </a>
            <a :href="a.vehicleStatsImage" target="_blank" rel="noopener">
              <img :src="a.vehicleStatsImage" :alt="$t('boost.applicationVehicleImage')" />
              <span>{{ $t('boost.applicationVehicleImage') }}</span>
            </a>
          </div>
          <div class="form-row">
            <label>{{ $t('boost.applicationAdminNote') }}</label>
            <input v-model="applicationNotes[a.id]" maxlength="500" :placeholder="a.adminNote || $t('boost.applicationAdminNoteHint')" />
          </div>
          <div class="admin-actions" v-if="a.status === 'NEW' || a.status === 'REVIEWING'">
            <button v-if="a.status === 'NEW'" class="btn-ghost btn-sm" @click="reviewApplication(a.id)">{{ $t('boost.action.REVIEWING') }}</button>
            <button class="btn-primary btn-sm" @click="approveApplication(a.id)">{{ $t('boost.applicationApprove') }}</button>
            <button class="btn-ghost btn-sm btn-danger" @click="rejectApplication(a.id)">{{ $t('boost.action.REJECTED') }}</button>
          </div>
          <div v-else-if="a.approvedBoosterId" class="boost-success">
            {{ $t('boost.applicationApprovedBooster', { id: a.approvedBoosterId }) }}
          </div>
        </div>
      </div>
      <div v-if="applicationPage.totalPages > 1" class="pager">
        <button :disabled="applicationPage.page <= 0" @click="loadAdminApplications(applicationPage.page - 1)">←</button>
        <span>{{ applicationPage.page + 1 }} / {{ applicationPage.totalPages }}</span>
        <button :disabled="applicationPage.page >= applicationPage.totalPages - 1" @click="loadAdminApplications(applicationPage.page + 1)">→</button>
      </div>
    </div>

    <!-- Tab: Boosters -->
    <div v-if="isAdmin && tab === 'boosters'" class="boost-card">
      <div class="flex-between">
        <h3 class="card-title">{{ $t('boost.boosters') }}</h3>
        <button class="btn-primary btn-sm" @click="startNewBooster()">{{ $t('boost.addBooster') }}</button>
      </div>

      <!-- Booster editor -->
      <div v-if="editingBooster !== null" class="booster-editor">
        <h4>{{ editingBooster.id ? $t('boost.editBooster') : $t('boost.newBooster') }}</h4>
        <div class="form-row">
          <label>{{ $t('boost.boosterLevel') }}</label>
          <select v-model="boosterForm.level">
            <option v-for="level in boosterLevels" :key="level" :value="level">{{ applicationLevelLabel(level) }}</option>
          </select>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.boosterStatus') }}</label>
          <select v-model="boosterForm.status">
            <option value="ACTIVE">{{ $t('boost.boosterStatusValue.ACTIVE') }}</option>
            <option value="INACTIVE">{{ $t('boost.boosterStatusValue.INACTIVE') }}</option>
            <option value="BANNED">{{ $t('boost.boosterStatusValue.BANNED') }}</option>
          </select>
        </div>
        <div class="form-row">
          <label><input type="checkbox" v-model="boosterForm.available" /> {{ $t('boost.boosterAvailable') }}</label>
        </div>
        <div class="form-row user-search-row">
          <label>{{ $t('boost.boosterUserSearch') }}</label>
          <input v-model="userSearchQuery" @input="searchUsers()" @focus="searchUsers()" @blur="setTimeout(() => showUserSearch = false, 200)" maxlength="100" :placeholder="$t('boost.boosterUserSearchHint')" />
          <div v-if="showUserSearch && userSearchResults.length" class="user-search-dropdown">
            <div v-for="u in userSearchResults" :key="u.keycloakUserId || u.id" class="user-search-item" @mousedown.prevent="selectUser(u)">
              <span class="user-search-name">{{ u.displayName || u.keycloakUsername || u.keycloakUserId }}</span>
              <span class="user-search-id" v-if="u.wotbNickname">{{ u.wotbNickname }}</span>
            </div>
          </div>
          <div v-if="showUserSearch && !userSearchResults.length && userSearchQuery.trim()" class="user-search-dropdown">
            <div class="user-search-empty">{{ $t('boost.noUsersFound') }}</div>
          </div>
          <input type="hidden" v-model="boosterForm.keycloakUserId" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.boosterContact') }}</label>
          <select v-model="boosterForm.contactType">
            <option value="">--</option>
            <option value="QQ">QQ</option>
            <option value="WECHAT">{{ $t('boost.contactWechat') }}</option>
          </select>
          <input v-model="boosterForm.contactValue" maxlength="255" :placeholder="$t('boost.contactHint')" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.boosterSpecialties') }}</label>
          <input v-model="boosterForm.specialties" maxlength="2000" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.boosterDesc') }}</label>
          <textarea v-model="boosterForm.description" rows="2" maxlength="2000"></textarea>
        </div>
        <div v-if="boosterError" class="boost-error">{{ boosterError }}</div>
        <div class="form-actions">
          <button class="btn-primary btn-sm" @click="saveBooster()">{{ $t('boost.save') }}</button>
          <button class="btn-ghost btn-sm" @click="cancelEditBooster()">{{ $t('boost.cancel') }}</button>
        </div>
      </div>

      <div v-if="loadingBoosters" class="boost-loading">{{ $t('boost.loading') }}</div>
      <div v-else-if="!boosters.length" class="boost-empty">{{ $t('boost.noBoosters') }}</div>
      <div v-else class="booster-list">
        <div v-for="b in boosters" :key="b.id" class="booster-item">
          <div class="booster-header">
            <strong>{{ b.nickname }}</strong>
            <span>{{ b.levelLabel }}</span>
            <span :class="'badge badge-' + statusBadge(b.status)">{{ b.statusLabel }}</span>
            <span :class="'badge badge-' + boosterAvailabilityBadge(b)">{{ boosterAvailabilityLabel(b) }}</span>
            <span class="booster-stats">{{ $t('boost.activeAssignments') }}: {{ b.activeAssignmentCount }}</span>
          </div>
          <div class="booster-meta" v-if="b.specialties">{{ b.specialties }}</div>
          <div class="booster-actions">
            <button class="btn-ghost btn-sm" @click="startEditBooster(b)">{{ $t('boost.edit') }}</button>
            <button class="btn-ghost btn-sm" @click="toggleBoosterAvailable(b)">
              {{ boosterAvailabilityActionLabel(b.available) }}
            </button>
            <button class="btn-ghost btn-sm btn-danger" @click="deleteBooster(b)">{{ $t('boost.delete') }}</button>
          </div>
        </div>
      </div>
      <div v-if="boosterPage.totalPages > 1" class="pager">
        <button :disabled="boosterPage.page <= 0" @click="loadBoosters(boosterPage.page - 1)">←</button>
        <span>{{ boosterPage.page + 1 }}</span>
        <button :disabled="boosterPage.page >= boosterPage.totalPages - 1" @click="loadBoosters(boosterPage.page + 1)">→</button>
      </div>
    </div>
  </div>

  <!-- Auth states -->
  <div v-else-if="phase === 'login' || phase === 'init'" class="boost-login">
    <p>{{ $t('boost.pleaseLogin') }}</p>
    <button class="btn-primary" @click="login()">{{ $t('app.login') }}</button>
  </div>
  <div v-else class="boost-error">
    <p>{{ $t('boost.authError') }}</p>
  </div>
</template>

<style scoped>
.boost-page { max-width: 1040px; margin: 0 auto; padding: 24px 20px 64px; }
.boost-tabs { display: inline-flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card2); }
.boost-tabs button { padding: 8px 16px; border: 1px solid transparent; background: transparent; color: var(--text-sub); border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
.boost-tabs button:hover { color: var(--text-label); background: var(--bg-card-hover); }
.boost-tabs button.active { background: var(--bg-card); color: var(--accent-dark); border-color: var(--border-tab-active); box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.boost-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; box-shadow: var(--surface-shadow); }
.card-title { margin: 0 0 12px; font-size: 18px; }
.boost-warning { background: var(--status-warn-bg); border: 1px solid var(--border-warn); border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px; color: var(--status-warn-fg); }
.boost-form .form-row { margin-bottom: 12px; }
.boost-form label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary); }
.boost-form input, .boost-form select, .boost-form textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); font-size: 14px; box-sizing: border-box; }
.boost-form textarea { resize: vertical; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field-hint { display: block; margin-top: 4px; color: var(--text-sub); font-size: 12px; }
.boost-error { color: var(--error); font-size: 13px; margin: 8px 0; }
.boost-success { color: var(--status-ok-fg); font-size: 13px; margin: 8px 0; }
.boost-loading, .boost-empty, .boost-login { text-align: center; padding: 40px; color: var(--text-secondary); }
.boost-hint { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.application-history { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--border); }
.application-history h4 { margin: 0 0 10px; font-size: 14px; color: var(--text-heading); }

.my-item, .admin-item, .booster-item { border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 10px; background: linear-gradient(180deg, var(--bg-card), color-mix(in srgb, var(--bg-card2) 36%, var(--bg-card))); }
.application-item { border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-bottom: 12px; background: linear-gradient(180deg, var(--bg-card), color-mix(in srgb, var(--bg-card2) 36%, var(--bg-card))); }
.application-item .form-row { margin: 10px 0; }
.application-item .form-row label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary); }
.application-item .form-row input { width: 100%; padding: 7px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); box-sizing: border-box; }
.my-header, .admin-header, .booster-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.my-type, .admin-player { font-weight: 600; }
.my-time, .admin-time { color: var(--text-secondary); font-size: 12px; margin-left: auto; }
.my-desc, .admin-desc { margin: 6px 0; font-size: 14px; }
.my-meta, .admin-meta { font-size: 12px; color: var(--text-secondary); display: flex; gap: 12px; flex-wrap: wrap; }
.my-actions, .admin-actions, .booster-actions { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.my-assigned { color: var(--status-ok-fg); font-weight: 700; }
.application-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; margin: 12px 0; font-size: 13px; }
.application-details div { display: flex; gap: 8px; justify-content: space-between; border-bottom: 1px solid var(--border-light); padding-bottom: 6px; }
.application-details span { color: var(--text-sub); }
.application-details strong { color: var(--text); text-align: right; word-break: break-word; }
.application-images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
.application-images a { display: grid; gap: 6px; color: var(--accent-dark); text-decoration: none; font-size: 12px; font-weight: 700; }
.application-images img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }

.badge { font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 700; }
.badge-info { background: var(--status-info-bg); color: var(--status-info-fg); }
.badge-warn { background: var(--status-warn-bg); color: var(--status-warn-fg); }
.badge-ok { background: var(--status-ok-bg); color: var(--status-ok-fg); }
.badge-err { background: var(--status-err-bg); color: var(--status-err-fg); }

.admin-filters { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.admin-filters select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
.admin-count { font-size: 12px; color: var(--text-secondary); }

.assign-box { margin-top: 10px; padding: 12px; background: var(--bg); border: 1px solid var(--border-light); border-radius: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.assign-box select, .assign-box input { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 13px; }
.mr { margin-right: 4px; }
.booster-editor { border: 1px solid var(--accent); border-radius: 8px; padding: 16px; margin-bottom: 16px; background: color-mix(in srgb, var(--accent) 6%, var(--bg-card)); }
.booster-editor .form-row { margin-bottom: 10px; }
.booster-editor label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 2px; }
.booster-editor input, .booster-editor select, .booster-editor textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); font-size: 13px; box-sizing: border-box; }
.form-actions { display: flex; gap: 8px; margin-top: 10px; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }

.pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 12px; font-size: 13px; }
.pager button { padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); cursor: pointer; }
.pager button:disabled { opacity: 0.4; cursor: default; }

.booster-stats { font-size: 12px; color: var(--text-secondary); margin-left: auto; }
.user-search-row { position: relative; }
.user-search-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 100; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; max-height: 240px; overflow-y: auto; margin-top: 2px; box-shadow: var(--hard-shadow); }
.user-search-item { padding: 8px 10px; cursor: pointer; font-size: 13px; display: flex; justify-content: space-between; }
.user-search-item:hover { background: var(--bg-card-hover); }
.user-search-name { font-weight: 600; }
.user-search-id { color: var(--text-secondary); font-size: 12px; }
.user-search-empty { padding: 10px; text-align: center; color: var(--text-secondary); font-size: 13px; }
.btn-danger { color: var(--error); border-color: var(--error); }
.btn-danger:hover { background: var(--error); color: var(--danger-solid-fg); }
/* Button styles (shared, used across ProfilePage and BoostPage) */
.btn-primary { padding: 8px 20px; border: none; border-radius: 7px; background: var(--accent); color: var(--accent-text); font-size: .88rem; cursor: pointer; font-family: inherit; font-weight: 700; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-ghost { padding: 8px 18px; border: 1px solid var(--border-ghost); border-radius: 7px; background: transparent; color: var(--text); font-size: .85rem; cursor: pointer; font-family: inherit; }
.btn-ghost:hover { background: var(--bg-card-hover); }
.btn-sm { padding: 5px 12px; font-size: .8rem; border-radius: 6px; }
@media (max-width: 640px) {
  .boost-page { padding: 14px 12px 48px; }
  .boost-tabs { display: flex; }
  .boost-tabs button { flex: 1 1 auto; }
  .flex-between { align-items: flex-start; gap: 10px; flex-direction: column; }
  .form-grid, .application-details, .application-images { grid-template-columns: 1fr; }
}
</style>
