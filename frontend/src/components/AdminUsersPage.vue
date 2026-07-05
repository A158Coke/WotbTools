<script setup>
import { ref, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import { useError } from '../composables/useError.js'
import * as api from '../utils/api-boost.js'

const { show: showError } = useError()
const users = ref([])
const loading = ref(false)
const searchQuery = ref('')
const detailUser = ref(null)
const showDetail = ref(false)
const deleteUserId = ref(null)
const deleteConfirmText = ref('')
const deleting = ref(false)
const deleteResult = ref('')

const { initPromise, keycloak } = useAuth()

async function ensureToken() {
  await initPromise
  try {
    await keycloak.updateToken(5)
  } catch {
    keycloak.login()
    throw new Error('Session expired, please login again')
  }
}

onMounted(async () => {
  try {
    await ensureToken()
    loadUsers()
  } catch (e) {
    showError(e.message)
  }
})

async function loadUsers() {
  loading.value = true
  try { users.value = await api.adminSearchUsers(searchQuery.value, 200) }
  catch (e) { showError(e.message); users.value = [] }
  finally { loading.value = false }
}

async function loadDetail(u) {
  try {
    detailUser.value = await api.adminGetUser(u.keycloakUserId)
    showDetail.value = true
  } catch (e) { showError(e.message) }
}

function closeDetail() { showDetail.value = false; detailUser.value = null }

function startDelete(u) { deleteUserId.value = u.keycloakUserId; deleteConfirmText.value = ''; deleteResult.value = ''; deleting.value = false }
function cancelDelete() { deleteUserId.value = null; deleteConfirmText.value = ''; deleteResult.value = '' }

async function confirmDelete() {
  deleting.value = true
  deleteResult.value = ''
  try {
    const res = await api.adminDeleteUser(deleteUserId.value)
    deleteResult.value = res.deleted ? 'DELETED' : (res.error || 'FAILED')
    setTimeout(() => { cancelDelete(); loadUsers() }, 1200)
  } catch (e) {
    deleteResult.value = e.message
  } finally { deleting.value = false }
}

function fmtTime(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div class="admin-page">
    <h2>{{ $t('admin.title') }}</h2>
    <p class="admin-hint">{{ $t('admin.hint') }}</p>

    <div class="admin-search">
      <input v-model="searchQuery" :placeholder="$t('admin.search')" @keyup.enter="loadUsers" />
      <button @click="loadUsers">{{ $t('admin.searchBtn') }}</button>
    </div>

    <p v-if="loading" class="admin-muted">{{ $t('admin.loading') }}</p>

    <div v-if="!loading && users.length" class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>{{ $t('admin.colId') }}</th>
            <th>{{ $t('admin.colDisplayName') }}</th>
            <th>{{ $t('admin.colKcId') }}</th>
            <th>{{ $t('admin.colAccountId') }}</th>
            <th>{{ $t('admin.colNickname') }}</th>
            <th>{{ $t('admin.colServer') }}</th>
            <th>{{ $t('admin.colCreated') }}</th>
            <th>{{ $t('admin.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.keycloakUserId">
            <td>{{ u.profileId }}</td>
            <td>{{ u.displayName }}</td>
            <td class="cell-mono cell-short">{{ u.keycloakUserId }}</td>
            <td>{{ u.wotbAccountId }}</td>
            <td>{{ u.wotbNickname }}</td>
            <td>{{ u.wotbServer }}</td>
            <td class="cell-time">{{ fmtTime(u.createdAt) }}</td>
            <td class="cell-actions">
              <button class="btn-sm" @click="loadDetail(u)">{{ $t('admin.view') }}</button>
              <button class="btn-sm btn-danger" @click="startDelete(u)">{{ $t('admin.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="admin-muted">{{ $t('admin.empty') }}</p>

    <!-- Detail Modal -->
    <div v-if="showDetail && detailUser" class="modal-overlay" @click.self="closeDetail">
      <div class="modal admin-modal">
        <h3>{{ $t('admin.detail') }}</h3>
        <div class="admin-detail">
          <div class="detail-section" v-if="detailUser.profile">
            <h4>Profile</h4>
            <div class="detail-row"><span class="dl">{{ $t('admin.colId') }}</span><span>{{ detailUser.profile.id }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.colDisplayName') }}</span><span>{{ detailUser.profile.displayName }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.colAccountId') }}</span><span>{{ detailUser.profile.wotbAccountId }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.colNickname') }}</span><span>{{ detailUser.profile.wotbNickname }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.colServer') }}</span><span>{{ detailUser.profile.wotbServer }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.colCreated') }}</span><span>{{ fmtTime(detailUser.profile.createdAt) }}</span></div>
          </div>
          <div class="detail-section" v-if="detailUser.keycloak">
            <h4>{{ $t('admin.keycloak') }}</h4>
            <div class="detail-row"><span class="dl">{{ $t('admin.colId') }}</span><span class="cell-mono">{{ detailUser.keycloak.id }}</span></div>
            <div class="detail-row"><span class="dl">Username</span><span>{{ detailUser.keycloak.username }}</span></div>
            <div class="detail-row"><span class="dl">Email</span><span>{{ detailUser.keycloak.email }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.enabled') }}</span><span>{{ detailUser.keycloak.enabled }}</span></div>
            <div class="detail-row" v-for="fi in (detailUser.keycloak.federatedIdentities || [])" :key="fi.userId">
              <span class="dl">{{ fi.identityProvider }}</span>
              <span>{{ fi.userName }} ({{ fi.userId }})</span>
            </div>
          </div>
          <p v-if="detailUser.warnings" class="admin-warn">{{ detailUser.warnings.join(', ') }}</p>
        </div>
        <button class="btn-sm" @click="closeDetail">{{ $t('admin.close') }}</button>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <div v-if="deleteUserId" class="modal-overlay" @click.self="cancelDelete">
      <div class="modal admin-modal confirm-modal">
        <h3 class="danger">{{ $t('admin.confirmDelete') }}</h3>
        <div class="admin-detail">
          <p>{{ $t('admin.confirmText') }}</p>
          <p class="admin-warn">{{ $t('admin.confirmWarn') }}</p>
          <p v-if="deleteResult === 'DELETED'" class="admin-ok">{{ $t('admin.deleted') }}</p>
          <p v-else-if="deleteResult" class="admin-error">{{ deleteResult }}</p>
          <div v-else>
            <label>{{ $t('admin.confirmInput') }}</label>
            <input v-model="deleteConfirmText" placeholder="DELETE" class="admin-confirm-input" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-sm" @click="cancelDelete">{{ $t('admin.cancel') }}</button>
          <button class="btn-sm btn-danger" :disabled="deleteConfirmText !== 'DELETE' || deleting" @click="confirmDelete">
            {{ deleting ? $t('admin.deleting') : $t('admin.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page { max-width: 1200px; margin: 0 auto; padding: 24px 20px 64px; }
.admin-page h2 { font-size: 1.3rem; margin: 0 0 4px; }
.admin-hint { font-size: .85rem; color: var(--text-sub); margin: 0 0 16px; }
.admin-search { display: flex; gap: 8px; margin-bottom: 16px; }
.admin-search input { flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); color: var(--text); font-size: .85rem; }
.admin-search button { padding: 8px 20px; border: none; border-radius: 7px; background: var(--accent); color: var(--accent-text); cursor: pointer; font-size: .85rem; font-weight: 700; }
.admin-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); box-shadow: var(--surface-shadow); }
.admin-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.admin-table th, .admin-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border-light); white-space: nowrap; }
.admin-table th { background: var(--bg-card2); font-weight: 600; color: var(--text-sub); font-size: .78rem; position: sticky; top: 0; }
.admin-table tbody tr:hover { background: var(--bg-list-hover); }
.cell-mono { font-family: monospace; font-size: .78rem; }
.cell-short { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.cell-time { font-size: .78rem; color: var(--text-sub); }
.cell-actions { display: flex; gap: 4px; }
.btn-sm { padding: 4px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); cursor: pointer; font-size: .8rem; font-family: inherit; }
.btn-sm:hover { background: var(--bg-card-hover); }
.btn-danger { color: var(--error); border-color: var(--error); }
.btn-danger:disabled { opacity: .4; cursor: not-allowed; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: var(--bg-card); border-radius: 12px; padding: 24px; max-width: 640px; width: 90%; max-height: 80vh; overflow-y: auto; }
.admin-modal h3 { margin: 0 0 16px; font-size: 1.1rem; }
.admin-modal h4 { margin: 0 0 8px; font-size: .95rem; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.detail-section { margin-bottom: 16px; }
.detail-row { display: flex; gap: 12px; padding: 4px 0; font-size: .85rem; }
.detail-row .dl { font-weight: 600; color: var(--text-sub); min-width: 110px; flex-shrink: 0; }
.admin-error { color: var(--error); font-size: .85rem; padding: 8px 0; }
.admin-warn { color: var(--status-warn-fg); font-size: .85rem; }
.admin-ok { color: var(--status-ok-fg); font-size: .85rem; font-weight: 700; }
.admin-muted { color: var(--text-sub); font-size: .85rem; padding: 16px 0; text-align: center; }
.confirm-modal { max-width: 480px; }
.confirm-modal .danger { color: var(--error); }
.admin-confirm-input { width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; margin-top: 4px; box-sizing: border-box; background: var(--bg-card); color: var(--text); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
