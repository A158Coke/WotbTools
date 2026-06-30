<script setup>
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const query = ref('')
const users = ref([])
const loading = ref(false)
const selectedUser = ref(null)
const showDetail = ref(false)
const showDeleteConfirm = ref(false)
const deleteConfirmInput = ref('')
const deleting = ref(false)
const deleteResult = ref(null)
const error = ref(null)

// 从 token 检查当前用户 ID
const tokenParsed = ref(null)

onMounted(async () => {
  // 尝试从 Keycloak 实例获取 token
  try {
    const kc = window._keycloak
    if (kc && kc.tokenParsed) {
      tokenParsed.value = kc.tokenParsed
    }
  } catch (e) {
    console.error('Failed to get Keycloak token', e)
  }
  await search()
})

async function apiFetch(url, opts = {}) {
  let token = ''
  try {
    const kc = window._keycloak
    if (kc && kc.token) token = kc.token
  } catch (e) {}
  const r = await fetch(url, {
    ...opts,
    headers: { ...opts.headers, 'Authorization': `Bearer ${token}` }
  })
  if (r.status === 403) throw new Error('FORBIDDEN')
  if (!r.ok) {
    const data = await r.json().catch(() => ({}))
    const err = new Error(data.message || `HTTP ${r.status}`)
    err.status = r.status
    err.data = data
    throw err
  }
  return r.json()
}

async function search() {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams()
    if (query.value) params.set('query', query.value)
    params.set('limit', '50')
    users.value = await apiFetch(`/api/admin/users?${params}`)
  } catch (e) {
    error.value = e.message
    if (e.status === 403) error.value = 'You do not have permission to access admin users.'
  } finally {
    loading.value = false
  }
}

async function openDetail(user) {
  try {
    const data = await apiFetch(`/api/admin/users/${user.keycloakUserId}`)
    selectedUser.value = data
    showDetail.value = true
  } catch (e) {
    error.value = e.message
  }
}

function closeDetail() {
  showDetail.value = false
  selectedUser.value = null
}

function openDeleteConfirm(user) {
  selectedUser.value = user
  deleteConfirmInput.value = ''
  deleteResult.value = null
  showDeleteConfirm.value = true
}

function closeDeleteConfirm() {
  showDeleteConfirm.value = false
  selectedUser.value = null
  deleteConfirmInput.value = ''
  deleteResult.value = null
}

const canDelete = computed(() => deleteConfirmInput.value === 'DELETE')

const isSelf = computed(() => {
  if (!selectedUser.value || !tokenParsed.value) return false
  return selectedUser.value.keycloakUserId === tokenParsed.value.sub
})

async function confirmDelete() {
  deleting.value = true
  error.value = null
  try {
    const data = await apiFetch(
      `/api/admin/users/${selectedUser.value.keycloakUserId}?confirm=true`,
      { method: 'DELETE' }
    )
    deleteResult.value = data
    if (data.deleted) {
      setTimeout(() => {
        closeDeleteConfirm()
        search()
      }, 1500)
    }
  } catch (e) {
    deleteResult.value = { deleted: false, error: e.data?.error, message: e.message }
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="admin-page">
    <h1>Admin Users</h1>

    <div class="search-bar">
      <input v-model="query" placeholder="Search by keycloakUserId / displayName / wotbNickname / wotbAccountId"
             @keyup.enter="search" class="search-input" />
      <button @click="search" class="search-btn">Search</button>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading...</div>

    <table v-if="!loading && users.length" class="user-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Display Name</th>
          <th>Keycloak User ID</th>
          <th>Account ID</th>
          <th>Nickname</th>
          <th>Server</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.keycloakUserId">
          <td>{{ u.profileId }}</td>
          <td>{{ u.displayName }}</td>
          <td class="kcell">{{ u.keycloakUserId }}</td>
          <td>{{ u.wotbAccountId }}</td>
          <td>{{ u.wotbNickname }}</td>
          <td>{{ u.wotbServer }}</td>
          <td>{{ u.createdAt }}</td>
          <td class="actions">
            <button @click="openDetail(u)" class="action-btn">View</button>
            <button @click="openDeleteConfirm(u)" :disabled="tokenParsed && u.keycloakUserId === tokenParsed.sub"
                    :title="tokenParsed && u.keycloakUserId === tokenParsed.sub ? 'You cannot delete your own admin account.' : ''"
                    class="action-btn danger">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!loading && users.length === 0 && !error" class="empty">No users found.</div>

    <!-- Detail Modal -->
    <div v-if="showDetail && selectedUser" class="modal-overlay" @click.self="closeDetail">
      <div class="modal">
        <h2>User Detail</h2>
        <div class="modal-body">
          <div v-if="selectedUser.profile" class="section">
            <h3>Profile</h3>
            <div class="field"><label>ID:</label><span>{{ selectedUser.profile.id }}</span></div>
            <div class="field"><label>Display Name:</label><span>{{ selectedUser.profile.displayName }}</span></div>
            <div class="field"><label>Account ID:</label><span>{{ selectedUser.profile.wotbAccountId }}</span></div>
            <div class="field"><label>Nickname:</label><span>{{ selectedUser.profile.wotbNickname }}</span></div>
            <div class="field"><label>Server:</label><span>{{ selectedUser.profile.wotbServer }}</span></div>
            <div class="field"><label>Created:</label><span>{{ selectedUser.profile.createdAt }}</span></div>
            <div class="field"><label>Updated:</label><span>{{ selectedUser.profile.updatedAt }}</span></div>
          </div>
          <div v-else class="section"><em>No local profile found.</em></div>

          <div v-if="selectedUser.keycloak" class="section">
            <h3>Keycloak</h3>
            <div class="field"><label>ID:</label><span>{{ selectedUser.keycloak.id }}</span></div>
            <div class="field"><label>Username:</label><span>{{ selectedUser.keycloak.username }}</span></div>
            <div class="field"><label>Email:</label><span>{{ selectedUser.keycloak.email }}</span></div>
            <div class="field"><label>First Name:</label><span>{{ selectedUser.keycloak.firstName }}</span></div>
            <div class="field"><label>Last Name:</label><span>{{ selectedUser.keycloak.lastName }}</span></div>
            <div class="field"><label>Enabled:</label><span>{{ selectedUser.keycloak.enabled }}</span></div>
            <div v-if="selectedUser.keycloak.federatedIdentities?.length" class="section">
              <h4>Federated Identities</h4>
              <div v-for="fi in selectedUser.keycloak.federatedIdentities" :key="fi.userId" class="field">
                <label>{{ fi.identityProvider }}:</label><span>{{ fi.userName }} ({{ fi.userId }})</span>
              </div>
            </div>
          </div>
          <div v-else class="section">
            <em>Keycloak user not found.</em>
            <div v-if="selectedUser.warnings" class="warnings">
              <div v-for="w in selectedUser.warnings" :key="w" class="warning">{{ w }}</div>
            </div>
          </div>
        </div>
        <button @click="closeDetail" class="modal-close">Close</button>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <div v-if="showDeleteConfirm && selectedUser" class="modal-overlay" @click.self="closeDeleteConfirm">
      <div class="modal confirm-modal">
        <h2 class="danger-title">Confirm Deletion</h2>
        <div class="modal-body">
          <div class="warning-box">
            This action will permanently delete the user from WotBTools and Keycloak.<br/>
            <strong>This operation cannot be undone.</strong>
          </div>
          <div class="target-info">
            <div v-if="selectedUser.displayName">Display name: {{ selectedUser.displayName }}</div>
            <div v-if="selectedUser.keycloakUsername">Keycloak username: {{ selectedUser.keycloakUsername }}</div>
            <div>Keycloak user id: {{ selectedUser.keycloakUserId }}</div>
            <div v-if="selectedUser.wotbAccountId">WotB account id: {{ selectedUser.wotbAccountId }}</div>
            <div v-if="selectedUser.wotbNickname">WotB nickname: {{ selectedUser.wotbNickname }}</div>
          </div>
          <div v-if="isSelf" class="error-msg">You cannot delete your own admin account.</div>
          <div v-if="deleteResult" class="delete-result">
            <div v-if="deleteResult.deleted" class="success">User deleted successfully.</div>
            <div v-else class="error-msg">{{ deleteResult.message }}</div>
          </div>
          <div v-if="!isSelf && !deleteResult">
            <label class="confirm-label">Type <strong>DELETE</strong> to confirm:</label>
            <input v-model="deleteConfirmInput" placeholder="Type DELETE here" class="confirm-input" />
          </div>
        </div>
        <div class="modal-actions">
          <button @click="closeDeleteConfirm" class="action-btn">Cancel</button>
          <button @click="confirmDelete" :disabled="!canDelete || deleting || isSelf"
                  class="action-btn danger">{{ deleting ? 'Deleting...' : 'Delete User' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page { padding: 24px; max-width: 1200px; margin: 0 auto; }
.search-bar { display: flex; gap: 8px; margin-bottom: 16px; }
.search-input { flex: 1; padding: 8px 12px; border: 1px solid var(--text-sub, #8b94a3); border-radius: 6px; background: var(--bg-card, #fff); color: var(--text, #222); }
.search-btn { padding: 8px 20px; background: var(--bg-blue, #3498db); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.user-table { width: 100%; border-collapse: collapse; }
.user-table th, .user-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--bg-card2, #eee); }
.user-table th { background: var(--bg-card2, #f1f4f8); font-weight: 600; }
.kcell { font-family: monospace; font-size: 0.85em; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; gap: 4px; }
.action-btn { padding: 4px 12px; border: 1px solid var(--text-sub, #8b94a3); border-radius: 4px; cursor: pointer; background: var(--bg-card, #fff); color: var(--text, #222); }
.action-btn.danger { color: #e74c3c; border-color: #e74c3c; }
.action-btn.danger:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--bg-card, #fff); border-radius: 12px; padding: 24px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto; color: var(--text, #222); }
.confirm-modal { max-width: 550px; }
.modal-body { margin: 16px 0; }
.section { margin-bottom: 16px; }
.section h3 { margin: 0 0 8px; font-size: 1.1em; border-bottom: 1px solid var(--bg-card2, #eee); padding-bottom: 4px; }
.field { display: flex; gap: 8px; margin: 4px 0; font-size: 0.95em; }
.field label { font-weight: 600; min-width: 120px; color: var(--text-sub, #555); }
.modal-close { padding: 8px 24px; border: 1px solid var(--text-sub, #8b94a3); border-radius: 6px; cursor: pointer; background: var(--bg-card, #fff); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.error-msg { color: #e74c3c; padding: 8px 0; }
.success { color: #27ae60; padding: 8px 0; font-weight: 600; }
.loading, .empty { color: var(--text-sub, #888); padding: 16px; }
.warnings { margin-top: 8px; }
.warning { color: #e67e22; font-size: 0.9em; }
.warning-box { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px; margin-bottom: 12px; color: #856404; }
.danger-title { color: #e74c3c; }
.target-info { margin-bottom: 12px; font-size: 0.9em; line-height: 1.6; }
.confirm-label { display: block; margin-bottom: 8px; }
.confirm-input { width: 100%; padding: 8px; border: 1px solid var(--text-sub, #8b94a3); border-radius: 4px; box-sizing: border-box; }
.delete-result { margin: 12px 0; }
</style>
