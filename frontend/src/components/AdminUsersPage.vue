<script setup>
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { useError } from '../composables/useError.js'
import { apiErrorCodeLabel, apiErrorLabel } from '../utils/display.js'
import { ApiError } from '../utils/http.js'
import * as api from '../utils/api-boost.js'

const { t, te } = useI18n()
const { show: showError } = useError()
const users = ref([])
const loading = ref(false)
const searchQuery = ref('')
// 服务端分页状态：page 为 0-based（与后端一致），UI 显示时 +1。
const page = ref(0)
const size = ref(25)
const totalItems = ref(0)
const totalPages = ref(0)
// segment=keycloak（Keycloak 权威）| segment=local（本地 user_profile 权威）。
const segment = ref('keycloak')
const idpAlias = ref('')
const detailUser = ref(null)
const showDetail = ref(false)
const deleteUserId = ref(null)
const deleteConfirmText = ref('')
const deleting = ref(false)
const deleteResult = ref('')

// 选择集合按「当前页」语义：第一列 = keycloakUserId（后端 deleteOneInternal 的 target）。
const selectedIds = ref([])
const selectedSet = computed(() => new Set(selectedIds.value))
const selectedCount = computed(() => selectedIds.value.length)
const allPageSelected = computed(() =>
  users.value.length > 0 && users.value.every(u => selectedSet.value.has(u.keycloakUserId)))
const showBulkConfirm = ref(false)
const bulkConfirmText = ref('')
const bulkDeleting = ref(false)
const bulkResult = ref(null)

let userLoadGeneration = 0
let detailLoadGeneration = 0

const { initPromise, keycloak } = useAuth()

function apiError(error) {
  return apiErrorLabel(t, te, error)
}

function errorCodeLabel(code) {
  return apiErrorCodeLabel(t, te, code)
}

async function ensureToken() {
  await initPromise
  try {
    await keycloak.updateToken(5)
  } catch {
    keycloak.login()
    throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
  }
}

onMounted(async () => {
  try {
    await ensureToken()
    loadUsers()
  } catch (e) {
    showError(apiError(e))
  }
})

function clearSelection() {
  selectedIds.value = []
}

async function loadUsers() {
  const generation = ++userLoadGeneration
  loading.value = true
  try {
    const res = await api.adminSearchUsers(searchQuery.value, {
      segment: segment.value,
      // 后端在 local segment 收到 idpAlias 会 400；禁用输入之外再兜一层。
      idpAlias: segment.value === 'keycloak' ? idpAlias.value.trim() : '',
      page: page.value,
      size: size.value,
    })
    if (generation !== userLoadGeneration) return
    const lastPage = Math.max((res?.totalPages || 0) - 1, 0)
    if (page.value > lastPage) {
      // 批量删除后当前页可能已不存在：退到最后一个有效页，由它自己结算 loading。
      page.value = lastPage
      await loadUsers()
      return
    }
    users.value = res?.items || []
    totalItems.value = res?.totalItems || 0
    totalPages.value = res?.totalPages || 0
    // 选择集收敛到当前页可见行：不允许「看不见的已选择项」进入批量删除。
    if (selectedIds.value.length) {
      selectedIds.value = selectedIds.value.filter(id => users.value.some(u => u.keycloakUserId === id))
    }
  } catch (e) {
    if (generation === userLoadGeneration) showError(apiError(e))
  } finally {
    if (generation === userLoadGeneration) loading.value = false
  }
}

// 翻页 / 换页长 / 换数据源 / 换搜索词都会改变可见行集合，
// 「全选当前页」的选择集不跨这些边界保留（否则会出现看不见的选中项）。
function reloadFirstPage() {
  clearSelection()
  page.value = 0
  loadUsers()
}

function onSearch() {
  reloadFirstPage()
}

function onSegmentChange() {
  if (segment.value !== 'keycloak') idpAlias.value = ''
  reloadFirstPage()
}

function onIdpAliasChange() {
  reloadFirstPage()
}

function onSizeChange() {
  reloadFirstPage()
}

function goPage(nextPage) {
  if (nextPage < 0 || nextPage === page.value) return
  if (totalPages.value > 0 && nextPage > totalPages.value - 1) return
  clearSelection()
  page.value = nextPage
  loadUsers()
}

function toggleSelect(u, checked) {
  const next = new Set(selectedIds.value)
  if (checked) next.add(u.keycloakUserId)
  else next.delete(u.keycloakUserId)
  selectedIds.value = [...next]
}

function toggleSelectAllPage(checked) {
  const next = new Set(selectedIds.value)
  for (const u of users.value) {
    if (checked) next.add(u.keycloakUserId)
    else next.delete(u.keycloakUserId)
  }
  selectedIds.value = [...next]
}

async function loadDetail(u) {
  const generation = ++detailLoadGeneration
  try {
    const result = await api.adminGetUser(u.keycloakUserId)
    if (generation === detailLoadGeneration) {
      detailUser.value = result
      showDetail.value = true
    }
  } catch (e) {
    if (generation === detailLoadGeneration) showError(apiError(e))
  }
}

function closeDetail() {
  detailLoadGeneration += 1
  showDetail.value = false
  detailUser.value = null
}

onBeforeUnmount(() => {
  userLoadGeneration += 1
  detailLoadGeneration += 1
})

function startDelete(u) { deleteUserId.value = u.keycloakUserId; deleteConfirmText.value = ''; deleteResult.value = ''; deleting.value = false }
function cancelDelete() { deleteUserId.value = null; deleteConfirmText.value = ''; deleteResult.value = '' }

async function confirmDelete() {
  deleting.value = true
  deleteResult.value = ''
  try {
    const target = deleteUserId.value
    // 单条删除就是长度为 1 的列表：与多选删除走同一个端点。
    const res = await api.adminDeleteUsers([target], true)
    const item = (res?.results || []).find(r => r.userId === target)
    deleteResult.value = item?.deleted ? 'DELETED' : apiError({ code: item?.errorCode || 'UNKNOWN_ERROR' })
    setTimeout(() => { cancelDelete(); loadUsers() }, 1200)
  } catch (e) {
    deleteResult.value = apiError(e)
  } finally { deleting.value = false }
}

// 批量删除：整批只弹一次确认，要求输入 DELETE（不逐条弹）。
function startBulkDelete() {
  if (!selectedCount.value) return
  bulkConfirmText.value = ''
  bulkResult.value = null
  bulkDeleting.value = false
  showBulkConfirm.value = true
}

function cancelBulkDelete() {
  showBulkConfirm.value = false
  bulkConfirmText.value = ''
  bulkResult.value = null
  bulkDeleting.value = false
}

async function confirmBulkDelete() {
  const ids = [...selectedIds.value]
  if (!ids.length || bulkConfirmText.value !== 'DELETE') return
  bulkDeleting.value = true
  try {
    const res = await api.adminDeleteUsers(ids, true)
    bulkResult.value = res
    // partial success：只有失败项留在选择集里，成功的整批（无论成功与否）都已被后端处理过。
    const failed = new Set((res?.results || []).filter(r => !r.deleted).map(r => r.userId))
    selectedIds.value = ids.filter(id => failed.has(id))
    bulkConfirmText.value = ''
    await loadUsers()
  } catch (e) {
    showError(apiError(e))
  } finally {
    bulkDeleting.value = false
  }
}

function fmtTime(s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div class="admin-page">
    <h2>{{ $t('admin.title') }}</h2>
    <p class="admin-hint">{{ $t('admin.hint') }}</p>

    <div class="admin-search">
      <input v-model="searchQuery" :placeholder="$t('admin.search')" @keyup.enter="onSearch" />
      <button @click="onSearch">{{ $t('admin.searchBtn') }}</button>
    </div>

    <div class="admin-filters">
      <label class="admin-filter">
        <span>{{ $t('admin.segment') }}</span>
        <select v-model="segment" @change="onSegmentChange">
          <option value="keycloak">{{ $t('admin.segmentKeycloak') }}</option>
          <option value="local">{{ $t('admin.segmentLocal') }}</option>
        </select>
      </label>
      <label class="admin-filter">
        <span>{{ $t('admin.idpAlias') }}</span>
        <input
          v-model="idpAlias"
          :disabled="segment !== 'keycloak'"
          :placeholder="$t('admin.idpAliasPlaceholder')"
          @keyup.enter="onIdpAliasChange"
        />
      </label>
      <p v-if="segment !== 'keycloak'" class="admin-muted admin-filter-hint">{{ $t('admin.idpAliasKeycloakOnly') }}</p>
    </div>

    <div v-if="selectedCount" class="admin-bulk-bar">
      <span class="admin-selected">{{ $t('admin.selectedCount', { count: selectedCount }) }}</span>
      <button class="btn-sm btn-danger" @click="startBulkDelete">{{ $t('admin.bulkDelete') }}</button>
      <button class="btn-sm" @click="clearSelection">{{ $t('admin.clearSelection') }}</button>
    </div>

    <p v-if="loading" class="admin-muted">{{ $t('admin.loading') }}</p>

    <div v-if="!loading && users.length" class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th class="cell-check">
              <input
                type="checkbox"
                :checked="allPageSelected"
                :aria-label="$t('admin.selectAllPage')"
                @change="toggleSelectAllPage($event.target.checked)"
              />
            </th>
            <th>{{ $t('admin.colId') }}</th>
            <th>{{ $t('admin.colDisplayName') }}</th>
            <th>{{ $t('admin.colKcUser') }}</th>
            <th>{{ $t('admin.colKcId') }}</th>
            <th>{{ $t('admin.colAccountId') }}</th>
            <th>{{ $t('admin.colNickname') }}</th>
            <th>{{ $t('admin.colServer') }}</th>
            <th>{{ $t('admin.colCreated') }}</th>
            <th>{{ $t('admin.colState') }}</th>
            <th>{{ $t('admin.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.keycloakUserId || u.profileId">
            <td class="cell-check">
              <input
                type="checkbox"
                :checked="selectedSet.has(u.keycloakUserId)"
                :aria-label="$t('admin.selectRow', { name: u.keycloakUsername || u.keycloakUserId })"
                @change="toggleSelect(u, $event.target.checked)"
              />
            </td>
            <td>{{ u.profileId }}</td>
            <td>{{ u.displayName }}</td>
            <td>
              <div class="cell-kc-user">{{ u.keycloakUsername || '—' }}</div>
              <div class="cell-time">{{ u.keycloakEmail || '—' }}</div>
            </td>
            <td class="cell-mono cell-short">{{ u.keycloakUserId }}</td>
            <td>{{ u.wotbAccountId ?? '—' }}</td>
            <td>{{ u.wotbNickname || '—' }}</td>
            <td>{{ u.wotbServer || '—' }}</td>
            <td class="cell-time">{{ fmtTime(u.profileCreatedAt) }}</td>
            <td>
              <span v-if="u.keycloakUserMissing" class="badge badge-warn">{{ $t('admin.kcUserMissing') }}</span>
              <span v-else-if="!u.hasLocalProfile" class="badge">{{ $t('admin.noLocalProfile') }}</span>
              <span v-else class="cell-time">{{ $t('admin.bound') }}</span>
            </td>
            <td class="cell-actions">
              <button
                class="btn-sm"
                :disabled="u.keycloakUserMissing"
                :title="u.keycloakUserMissing ? $t('admin.detailUnavailable') : ''"
                @click="loadDetail(u)"
              >{{ $t('admin.view') }}</button>
              <button class="btn-sm btn-danger" @click="startDelete(u)">{{ $t('admin.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="admin-muted">{{ $t('admin.empty') }}</p>

    <div v-if="totalPages > 0" class="admin-pagination">
      <button class="btn-sm" :disabled="page <= 0" @click="goPage(page - 1)">{{ $t('admin.prev') }}</button>
      <span class="admin-page-info">{{ $t('admin.pageInfo', { page: page + 1, total: totalPages, items: totalItems }) }}</span>
      <button class="btn-sm" :disabled="page + 1 >= totalPages" @click="goPage(page + 1)">{{ $t('admin.next') }}</button>
      <label class="admin-filter">
        <span>{{ $t('admin.size') }}</span>
        <select v-model.number="size" @change="onSizeChange">
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </label>
    </div>

    <!-- Detail Modal -->
    <div v-if="showDetail && detailUser" class="modal-overlay" @click.self="closeDetail">
      <div class="modal admin-modal">
        <h3>{{ $t('admin.detail') }}</h3>
        <div class="admin-detail">
          <div class="detail-section" v-if="detailUser.profile">
            <h4>{{ $t('admin.profileSection') }}</h4>
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
            <div class="detail-row"><span class="dl">{{ $t('admin.username') }}</span><span>{{ detailUser.keycloak.username }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.email') }}</span><span>{{ detailUser.keycloak.email }}</span></div>
            <div class="detail-row"><span class="dl">{{ $t('admin.enabled') }}</span><span>{{ detailUser.keycloak.enabled }}</span></div>
            <div class="detail-row" v-for="fi in (detailUser.keycloak.federatedIdentities || [])" :key="fi.userId">
              <span class="dl">{{ fi.identityProvider }}</span>
              <span>{{ fi.userName }} ({{ fi.userId }})</span>
            </div>
          </div>
          <p v-if="detailUser.warnings?.length" class="admin-warn">{{ detailUser.warnings.map(warning => apiErrorLabel(t, te, { code: warning })).join(', ') }}</p>
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
            <input v-model="deleteConfirmText" :placeholder="$t('admin.deleteKeyword')" class="admin-confirm-input" />
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

    <!-- Bulk Delete Confirm Modal（整批只弹一次） -->
    <div v-if="showBulkConfirm" class="modal-overlay" @click.self="cancelBulkDelete">
      <div class="modal admin-modal confirm-modal bulk-confirm-modal">
        <h3 class="danger">{{ $t('admin.bulkConfirmDelete') }}</h3>
        <div class="admin-detail">
          <p>{{ $t('admin.bulkConfirmText', { count: selectedCount }) }}</p>
          <p class="admin-warn">{{ $t('admin.confirmWarn') }}</p>
          <template v-if="bulkResult">
            <p class="admin-ok">{{ $t('admin.bulkSummary', { requested: bulkResult.requested, deleted: bulkResult.deleted, failed: bulkResult.failed }) }}</p>
            <div v-if="bulkResult.results?.some(r => !r.deleted)" class="bulk-failures">
              <p class="admin-warn">{{ $t('admin.bulkFailures') }}</p>
              <ul>
                <li v-for="item in bulkResult.results.filter(r => !r.deleted)" :key="item.userId" class="cell-mono">
                  {{ item.userId }} — {{ errorCodeLabel(item.errorCode) }}
                </li>
              </ul>
            </div>
          </template>
          <div v-else>
            <label>{{ $t('admin.confirmInput') }}</label>
            <input v-model="bulkConfirmText" :placeholder="$t('admin.deleteKeyword')" class="admin-confirm-input" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-sm" @click="cancelBulkDelete">{{ bulkResult ? $t('admin.close') : $t('admin.cancel') }}</button>
          <button
            v-if="!bulkResult"
            class="btn-sm btn-danger"
            :disabled="bulkConfirmText !== 'DELETE' || bulkDeleting"
            @click="confirmBulkDelete"
          >
            {{ bulkDeleting ? $t('admin.deleting') : $t('admin.bulkDelete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page { max-width: 1200px; margin: 0 auto; padding: 24px 20px 64px; }
.admin-page h2 { font-size: 1.3rem; margin: 0 0 4px; color: #f2ede3; }
.admin-hint { font-size: .85rem; color: #9aa09c; margin: 0 0 16px; }
.admin-search { display: flex; gap: 8px; margin-bottom: 16px; }
.admin-search input { flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); color: var(--text); font-size: .85rem; }
.admin-search button { padding: 8px 20px; border: none; border-radius: 7px; background: var(--accent); color: var(--accent-text); cursor: pointer; font-size: .85rem; font-weight: 700; }
.admin-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
.admin-filter { display: flex; align-items: center; gap: 6px; font-size: .82rem; color: var(--text-sub); }
.admin-filter select, .admin-filter input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-card); color: var(--text); font-size: .82rem; font-family: inherit; }
.admin-filter input:disabled { opacity: .5; cursor: not-allowed; }
.admin-filter-hint { margin: 0; padding: 0; text-align: left; }
.admin-bulk-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card2); }
.admin-selected { font-size: .82rem; color: var(--text-sub); font-weight: 600; }
.admin-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); box-shadow: var(--surface-shadow); }
.admin-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.admin-table th, .admin-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #263136; white-space: nowrap; }
.admin-table th { background: var(--bg-card2); font-weight: 600; color: var(--text-sub); font-size: .78rem; position: sticky; top: 0; }
.admin-table tbody tr:hover { background: var(--bg-list-hover); }
.admin-table td { color: #d8d5cd; }
.cell-check { width: 32px; }
.cell-check input { cursor: pointer; }
.cell-mono { font-family: monospace; font-size: .78rem; }
.cell-short { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.cell-time { font-size: .78rem; color: #9aa09c; }
.cell-kc-user { font-size: .82rem; }
.cell-actions { display: flex; gap: 4px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-card2); color: var(--text-sub); font-size: .72rem; }
.badge-warn { border-color: #f0c97e; color: #f0c97e; }
.admin-pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.admin-page-info { font-size: .82rem; color: var(--text-sub); }
.btn-sm { padding: 4px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text); cursor: pointer; font-size: .8rem; font-family: inherit; }
.btn-sm:hover { background: var(--bg-list-hover); }
.btn-sm:disabled { opacity: .4; cursor: not-allowed; }
.btn-danger { color: var(--error); border-color: var(--error); }
.btn-danger:disabled { opacity: .4; cursor: not-allowed; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: var(--bg-card); border-radius: 12px; padding: 24px; max-width: 640px; width: 90%; max-height: 80vh; overflow-y: auto; }
.admin-modal h3 { margin: 0 0 16px; font-size: 1.1rem; }
.admin-modal h4 { margin: 0 0 8px; font-size: .95rem; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.detail-section { margin-bottom: 16px; }
.detail-row { display: flex; gap: 12px; padding: 4px 0; font-size: .85rem; }
.detail-row .dl { font-weight: 600; color: var(--text-sub); min-width: 110px; flex-shrink: 0; }
.admin-error { color: #ff8f86; font-size: .85rem; padding: 8px 0; }
.admin-warn { color: #f0c97e; font-size: .85rem; }
.admin-ok { color: #9fd39a; font-size: .85rem; font-weight: 700; }
.admin-muted { color: #9aa09c; font-size: .85rem; padding: 16px 0; text-align: center; }
.confirm-modal { max-width: 480px; }
.confirm-modal .danger { color: var(--error); }
.admin-confirm-input { width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px; margin-top: 4px; box-sizing: border-box; background: var(--bg-card); color: var(--text); }
.bulk-failures ul { margin: 4px 0 0; padding-left: 18px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
