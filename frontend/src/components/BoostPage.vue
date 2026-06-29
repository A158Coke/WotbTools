<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import * as api from '../utils/api-boost.js'

const { t } = useI18n()
const { initPromise, login, isAuthenticated, userName, tokenParsed } = useAuth()

// Auth gate
const phase = ref('init')
const user = ref('')

// Tabs
const tab = ref('request')

// Options (dropdown data)
const options = ref({ regions: [], requestTypes: [], contactTypes: [], warning: '' })

// Form
const form = ref({ region: 'CN', requestType: 'COACHING', contactType: 'QQ', targetDescription: '', contactValue: '', playerNickname: '', playerAccountId: null, budgetRange: '', availableTime: '', remark: '' })
const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')

// My requests
const myRequests = ref([])
const loadingMy = ref(false)

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

// Admin: booster list
const boosters = ref([])
const boosterPage = ref({ page: 0, size: 20 })
const loadingBoosters = ref(false)
const editingBooster = ref(null)
const boosterForm = ref({ nickname: '', level: 'ELITE', available: true, status: 'ACTIVE', contactType: '', contactValue: '', specialties: '', description: '' })
const boosterError = ref('')

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
    } else {
      phase.value = 'login'
      login()
    }
  } catch {
    phase.value = 'error'
  }
})

async function loadOptions() {
  try { options.value = await api.boostOptions() } catch {}
}

async function loadMyRequests() {
  loadingMy.value = true
  try { myRequests.value = await api.boostListMyRequests() } catch { myRequests.value = [] }
  finally { loadingMy.value = false }
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
    const res = await api.boostCreateRequest(form.value)
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
    await api.boostCancelRequest(id)
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
    const data = await api.adminBoostRequests(params)
    adminRequests.value = data.content || []
    adminPage.value = { page: data.page, size: data.size, totalElements: data.totalElements, totalPages: data.totalPages }
  } catch { adminRequests.value = [] }
  finally { loadingAdmin.value = false }
}

async function updateStatus(id, status) {
  try {
    await api.adminBoostUpdateStatus(id, { status, adminNote: '' })
    loadAdminRequests(adminPage.value.page)
  } catch (e) { alert(e.message) }
}

async function assignBooster(id) {
  assignError.value = ''
  try {
    await api.adminBoostAssign(id, { boosterId: assignBoosterId.value, note: assignNote.value })
    assigningRequest.value = null
    assignBoosterId.value = null
    assignNote.value = ''
    loadAdminRequests(adminPage.value.page)
  } catch (e) { assignError.value = e.message }
}

async function unassignBooster(id) {
  try {
    await api.adminBoostUnassign(id, { note: '' })
    loadAdminRequests(adminPage.value.page)
  } catch (e) { alert(e.message) }
}

async function loadBoosters(page = 0) {
  loadingBoosters.value = true
  try {
    const data = await api.adminBoostBoosterList({ page, size: boosterPage.value.size })
    boosters.value = data.content || []
    boosterPage.value = { page: data.page, size: data.size, totalElements: data.totalElements, totalPages: data.totalPages }
  } catch { boosters.value = [] }
  finally { loadingBoosters.value = false }
}

function startNewBooster() {
  editingBooster.value = {}
  boosterForm.value = { nickname: '', level: 'ELITE', available: true, status: 'ACTIVE', contactType: '', contactValue: '', specialties: '', description: '' }
  boosterError.value = ''
}

function startEditBooster(b) {
  editingBooster.value = b
  boosterForm.value = { nickname: b.nickname || '', level: b.level || 'ELITE', available: b.available, status: b.status || 'ACTIVE', contactType: b.contactType || '', contactValue: b.contactValue || '', specialties: b.specialties || '', description: b.description || '' }
  boosterError.value = ''
}

function cancelEditBooster() {
  editingBooster.value = null
}

async function saveBooster() {
  boosterError.value = ''
  try {
    if (editingBooster.value?.id) {
      await api.adminBoostBoosterUpdate(editingBooster.value.id, boosterForm.value)
    } else {
      await api.adminBoostBoosterCreate(boosterForm.value)
    }
    editingBooster.value = null
    loadBoosters(boosterPage.value.page)
  } catch (e) { boosterError.value = e.message }
}

async function toggleBoosterAvailable(b) {
  try {
    await api.adminBoostBoosterAvailability(b.id, { available: !b.available })
    loadBoosters(boosterPage.value.page)
  } catch (e) { alert(e.message) }
}

function statusBadge(s) {
  const map = { NEW: 'info', REVIEWING: 'warn', MATCHED: 'ok', CLOSED: 'ok', REJECTED: 'err', CANCELLED: 'err', ASSIGNED: 'ok', ACTIVE: 'ok', INACTIVE: 'warn', BANNED: 'err' }
  return map[s] || ''
}

function switchTab(t) {
  tab.value = t
  if (t === 'adminRequests') { loadAdminRequests(); loadBoosters() }
  else if (t === 'boosters') loadBoosters()
}
</script>

<template>
  <div class="boost-page" v-if="phase === 'done'">
    <!-- Tabs -->
    <div class="boost-tabs">
      <button :class="{ active: tab === 'request' }" @click="switchTab('request')">{{ $t('boost.submitTab') }}</button>
      <button :class="{ active: tab === 'my' }" @click="switchTab('my')">{{ $t('boost.myTab') }}</button>
      <template v-if="isAdmin">
        <button :class="{ active: tab === 'adminRequests' }" @click="switchTab('adminRequests')">{{ $t('boost.adminRequestsTab') }}</button>
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
              <option v-for="b in boosters" :key="b.id" :value="b.id" :disabled="!b.available || b.status !== 'ACTIVE'">
                {{ b.nickname }} ({{ b.levelLabel }}) {{ b.available ? '' : '[' + $t('boost.unavailable') + ']' }}
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
          <label>{{ $t('boost.boosterNickname') }} *</label>
          <input v-model="boosterForm.nickname" maxlength="100" />
        </div>
        <div class="form-row">
          <label>{{ $t('boost.boosterLevel') }}</label>
          <select v-model="boosterForm.level">
            <option value="CASUAL">普通</option>
            <option value="SKILLED">熟练</option>
            <option value="ELITE">高手</option>
            <option value="PRO">职业级</option>
          </select>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.boosterStatus') }}</label>
          <select v-model="boosterForm.status">
            <option value="ACTIVE">正常</option>
            <option value="INACTIVE">停用</option>
            <option value="BANNED">禁用</option>
          </select>
        </div>
        <div class="form-row">
          <label><input type="checkbox" v-model="boosterForm.available" /> {{ $t('boost.boosterAvailable') }}</label>
        </div>
        <div class="form-row">
          <label>{{ $t('boost.boosterContact') }}</label>
          <select v-model="boosterForm.contactType">
            <option value="">--</option>
            <option value="QQ">QQ</option>
            <option value="WECHAT">微信</option>
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
            <span v-if="!b.available" class="badge badge-warn">{{ $t('boost.unavailable') }}</span>
            <span class="booster-stats">活跃: {{ b.activeAssignmentCount }}</span>
          </div>
          <div class="booster-meta" v-if="b.specialties">{{ b.specialties }}</div>
          <div class="booster-actions">
            <button class="btn-ghost btn-sm" @click="startEditBooster(b)">{{ $t('boost.edit') }}</button>
            <button class="btn-ghost btn-sm" @click="toggleBoosterAvailable(b)">
              {{ b.available ? $t('boost.setUnavailable') : $t('boost.setAvailable') }}
            </button>
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
.boost-page { max-width: 800px; margin: 0 auto; padding: 20px; }
.boost-tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
.boost-tabs button { padding: 8px 16px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); border-radius: 6px 6px 0 0; cursor: pointer; font-size: 14px; }
.boost-tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.boost-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 0 8px 8px 8px; padding: 20px; }
.card-title { margin: 0 0 12px; font-size: 18px; }
.boost-warning { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px; color: #856404; }
.boost-form .form-row { margin-bottom: 12px; }
.boost-form label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary); }
.boost-form input, .boost-form select, .boost-form textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font-size: 14px; box-sizing: border-box; }
.boost-form textarea { resize: vertical; }
.boost-error { color: #dc3545; font-size: 13px; margin: 8px 0; }
.boost-success { color: #28a745; font-size: 13px; margin: 8px 0; }
.boost-loading, .boost-empty, .boost-login { text-align: center; padding: 40px; color: var(--text-secondary); }
.boost-hint { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

.my-item, .admin-item, .booster-item { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.my-header, .admin-header, .booster-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.my-type, .admin-player { font-weight: 600; }
.my-time, .admin-time { color: var(--text-secondary); font-size: 12px; margin-left: auto; }
.my-desc, .admin-desc { margin: 6px 0; font-size: 14px; }
.my-meta, .admin-meta { font-size: 12px; color: var(--text-secondary); display: flex; gap: 12px; flex-wrap: wrap; }
.my-actions, .admin-actions, .booster-actions { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.my-assigned { color: #28a745; font-weight: 600; }

.badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
.badge-info { background: #d1ecf1; color: #0c5460; }
.badge-warn { background: #fff3cd; color: #856404; }
.badge-ok { background: #d4edda; color: #155724; }
.badge-err { background: #f8d7da; color: #721c24; }

.admin-filters { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.admin-filters select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
.admin-count { font-size: 12px; color: var(--text-secondary); }

.assign-box { margin-top: 8px; padding: 10px; background: var(--bg); border-radius: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.assign-box select, .assign-box input { padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); font-size: 13px; }
.mr { margin-right: 4px; }

.booster-editor { border: 1px solid var(--accent); border-radius: 8px; padding: 16px; margin-bottom: 16px; background: var(--bg); }
.booster-editor .form-row { margin-bottom: 10px; }
.booster-editor label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 2px; }
.booster-editor input, .booster-editor select, .booster-editor textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-card); color: var(--text); font-size: 13px; box-sizing: border-box; }
.form-actions { display: flex; gap: 8px; margin-top: 10px; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }

.pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 12px; font-size: 13px; }
.pager button { padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-card); color: var(--text); cursor: pointer; }
.pager button:disabled { opacity: 0.4; cursor: default; }

.booster-stats { font-size: 12px; color: var(--text-secondary); margin-left: auto; }
</style>
