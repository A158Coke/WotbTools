<script setup>
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { useError } from '../composables/useError.js'
import { apiErrorCodeLabel, apiErrorLabel } from '../utils/display.js'
import { ApiError } from '../utils/http.js'
import * as api from '../utils/api.js'
import AppDialog from './AppDialog.vue'

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

const { initPromise, ensureToken: ensureAuthToken, login } = useAuth()

function apiError(error) {
  return apiErrorLabel(t, te, error)
}

function errorCodeLabel(code) {
  return apiErrorCodeLabel(t, te, code)
}

async function ensureToken() {
  await initPromise
  if (!(await ensureAuthToken(5))) {
    login()
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
    <h1 class="admin-title">{{ $t('admin.title') }}</h1>
    <p class="admin-hint">{{ $t('admin.hint') }}</p>

    <div class="admin-search">
      <input v-model="searchQuery" :placeholder="$t('admin.search')" @keyup.enter="onSearch" />
      <button type="button" class="admin-search-btn" @click="onSearch">{{ $t('admin.searchBtn') }}</button>
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
              <label class="check-hit">
                <input
                  type="checkbox"
                  :checked="allPageSelected"
                  :aria-label="$t('admin.selectAllPage')"
                  @change="toggleSelectAllPage($event.target.checked)"
                />
              </label>
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
            <th class="cell-actions">{{ $t('admin.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.keycloakUserId || u.profileId">
            <td class="cell-check">
              <label class="check-hit">
                <input
                  type="checkbox"
                  :checked="selectedSet.has(u.keycloakUserId)"
                  :aria-label="$t('admin.selectRow', { name: u.keycloakUsername || u.keycloakUserId })"
                  @change="toggleSelect(u, $event.target.checked)"
                />
              </label>
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
                type="button"
                class="btn-sm"
                :disabled="u.keycloakUserMissing"
                :title="u.keycloakUserMissing ? $t('admin.detailUnavailable') : ''"
                @click="loadDetail(u)"
              >{{ $t('admin.view') }}</button>
              <button type="button" class="btn-sm btn-danger" @click="startDelete(u)">{{ $t('admin.delete') }}</button>
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

    <!-- 详情（AppDialog：焦点陷阱 / Esc / 关闭后焦点回到触发按钮） -->
    <AppDialog :open="showDetail && !!detailUser" :title="$t('admin.detail')" class="admin-modal detail-modal" @close="closeDetail">
      <div class="admin-detail">
        <section v-if="detailUser?.profile" class="detail-section">
          <h3 class="detail-heading">{{ $t('admin.profileSection') }}</h3>
          <dl class="detail-list">
            <div class="detail-row"><dt>{{ $t('admin.colId') }}</dt><dd>{{ detailUser.profile.id }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.colDisplayName') }}</dt><dd>{{ detailUser.profile.displayName }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.colAccountId') }}</dt><dd>{{ detailUser.profile.wotbAccountId }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.colNickname') }}</dt><dd>{{ detailUser.profile.wotbNickname }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.colServer') }}</dt><dd>{{ detailUser.profile.wotbServer }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.colCreated') }}</dt><dd>{{ fmtTime(detailUser.profile.createdAt) }}</dd></div>
          </dl>
        </section>
        <section v-if="detailUser?.keycloak" class="detail-section">
          <h3 class="detail-heading">{{ $t('admin.keycloak') }}</h3>
          <dl class="detail-list">
            <div class="detail-row"><dt>{{ $t('admin.colId') }}</dt><dd class="cell-mono">{{ detailUser.keycloak.id }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.username') }}</dt><dd>{{ detailUser.keycloak.username }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.email') }}</dt><dd>{{ detailUser.keycloak.email }}</dd></div>
            <div class="detail-row"><dt>{{ $t('admin.enabled') }}</dt><dd>{{ detailUser.keycloak.enabled }}</dd></div>
            <div v-for="fi in (detailUser.keycloak.federatedIdentities || [])" :key="fi.userId" class="detail-row">
              <dt>{{ fi.identityProvider }}</dt>
              <dd>{{ fi.userName }} ({{ fi.userId }})</dd>
            </div>
          </dl>
        </section>
        <p v-if="detailUser?.warnings?.length" class="admin-warn">{{ detailUser.warnings.map(warning => apiErrorLabel(t, te, { code: warning })).join(', ') }}</p>
      </div>
      <template #actions>
        <button type="button" class="btn-sm" @click="closeDetail">{{ $t('admin.close') }}</button>
      </template>
    </AppDialog>

    <!-- 单个删除确认（需输入 DELETE） -->
    <AppDialog
      :open="!!deleteUserId"
      :title="$t('admin.confirmDelete')"
      size="sm"
      tone="danger"
      class="admin-modal confirm-modal"
      @close="!deleting && cancelDelete()"
    >
      <div class="admin-detail">
        <p>{{ $t('admin.confirmText') }}</p>
        <p class="admin-warn">{{ $t('admin.confirmWarn') }}</p>
        <p v-if="deleteResult === 'DELETED'" class="admin-ok">{{ $t('admin.deleted') }}</p>
        <p v-else-if="deleteResult" class="admin-error">{{ deleteResult }}</p>
        <label v-else class="admin-confirm-field">
          <span>{{ $t('admin.confirmInput') }}</span>
          <input v-model="deleteConfirmText" :placeholder="$t('admin.deleteKeyword')" class="admin-confirm-input" />
        </label>
      </div>
      <template #actions>
        <button type="button" class="btn-sm" @click="cancelDelete">{{ $t('admin.cancel') }}</button>
        <button type="button" class="btn-sm btn-danger" :disabled="deleteConfirmText !== 'DELETE' || deleting" @click="confirmDelete">
          {{ deleting ? $t('admin.deleting') : $t('admin.delete') }}
        </button>
      </template>
    </AppDialog>

    <!-- 批量删除确认（整批只弹一次） -->
    <AppDialog
      :open="showBulkConfirm"
      :title="$t('admin.bulkConfirmDelete')"
      size="sm"
      tone="danger"
      class="admin-modal confirm-modal bulk-confirm-modal"
      @close="!bulkDeleting && cancelBulkDelete()"
    >
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
        <label v-else class="admin-confirm-field">
          <span>{{ $t('admin.confirmInput') }}</span>
          <input v-model="bulkConfirmText" :placeholder="$t('admin.deleteKeyword')" class="admin-confirm-input" />
        </label>
      </div>
      <template #actions>
        <button type="button" class="btn-sm" @click="cancelBulkDelete">{{ bulkResult ? $t('admin.close') : $t('admin.cancel') }}</button>
        <button
          v-if="!bulkResult"
          type="button"
          class="btn-sm btn-danger"
          :disabled="bulkConfirmText !== 'DELETE' || bulkDeleting"
          @click="confirmBulkDelete"
        >
          {{ bulkDeleting ? $t('admin.deleting') : $t('admin.bulkDelete') }}
        </button>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
/* 设计语言 token（docs/frontend/design-language.md）：本组件是用户管理页样式的唯一 owner，
 * showcase / classic 不再覆盖内部元素；两套主题只通过语义 token 换色。 */
.admin-page { padding-block: var(--space-6) var(--space-12); color: var(--color-text-primary); font: var(--type-body); }
.admin-title { margin: 0 0 var(--space-1); color: var(--color-text-primary); font: var(--type-h1); }
.admin-hint { margin: 0 0 var(--space-4); color: var(--color-text-secondary); }

.admin-search { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); }

.admin-page input:not([type="checkbox"]),
.admin-page select,
.admin-confirm-input {
  box-sizing: border-box;
  min-width: 0;
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}

.admin-search input { flex: 1 1 auto; }

.admin-search-btn {
  flex: none;
  min-height: var(--control-h-md);
  padding: 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  font: var(--type-body);
  font-weight: 600;
  cursor: pointer;
}

.admin-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.admin-filter { display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-secondary); }
.admin-filter input:disabled { cursor: not-allowed; opacity: .5; }
.admin-filter-hint { margin: 0; padding: 0; text-align: left; }

.admin-bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}

.admin-selected { color: var(--color-text-primary); font-weight: 600; }

/* 表格：容器横向滚动；操作列（查看 / 删除）吸附在右侧，手机上始终可达（审计 PG-10）。
 * isolation 建立局部层叠上下文，表头 / 操作列的 z-index 不参与全局竞争（§5） */
.admin-table-wrap {
  isolation: isolate;
  overflow-x: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.admin-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font: var(--type-body);
  font-variant-numeric: tabular-nums;
}

.admin-table th,
.admin-table td {
  height: var(--row-h);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--color-border-subtle);
  text-align: left;
  white-space: nowrap;
}

.admin-table th {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}

.admin-table td { background: var(--color-surface-1); color: var(--color-text-primary); }

.cell-actions {
  position: sticky;
  right: 0;
  z-index: var(--z-base);
  border-left: 1px solid var(--color-border-subtle);
}

td.cell-actions > * + * { margin-left: var(--space-1); }

/* 复选框：放大到控件尺寸 token，label 提供最小点击区域 */
.cell-check { width: var(--hit-min); padding: 0; text-align: center; }

.check-hit {
  display: inline-grid;
  place-items: center;
  min-width: var(--hit-min);
  min-height: var(--hit-min);
  cursor: pointer;
}

.check-hit input {
  inline-size: var(--control-check);
  block-size: var(--control-check);
  margin: 0;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.cell-mono { font-family: var(--font-family-mono); font-size: var(--font-size-caption); }
.cell-short { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.cell-time { color: var(--color-text-secondary); font-size: var(--font-size-caption); }

.badge {
  display: inline-block;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
}

.badge-warn { border-color: var(--color-warning); color: var(--color-warning); }

.admin-pagination { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-top: var(--space-3); }
.admin-page-info { color: var(--color-text-secondary); }

.btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  cursor: pointer;
}

.btn-danger { border-color: var(--color-danger); color: var(--color-danger); }
.btn-sm:disabled { cursor: not-allowed; opacity: .5; }

.btn-sm:focus-visible,
.admin-search-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .admin-table tbody tr:hover td { background: var(--color-surface-2); }
  .btn-sm:hover:not(:disabled) { background: var(--color-surface-2); }
  .btn-danger:hover:not(:disabled) { background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1)); }
  .admin-search-btn:hover { background: color-mix(in oklab, var(--color-accent) 88%, var(--color-text-primary)); }
}

/* 对话框内容（外壳由 AppDialog 负责） */
.detail-section + .detail-section { margin-top: var(--space-4); }

.detail-heading {
  margin: 0 0 var(--space-2);
  padding-bottom: var(--space-1);
  border-bottom: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font: var(--type-body);
  font-weight: 600;
}

.detail-list { margin: 0; }
.detail-row { display: flex; gap: var(--space-3); padding: var(--space-1) 0; }
.detail-row dt { flex: none; min-width: 110px; color: var(--color-text-secondary); font-weight: 600; }
.detail-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }

.admin-error { padding: var(--space-2) 0; color: var(--color-danger); }
.admin-warn { color: var(--color-warning); }
.admin-ok { color: var(--color-success); font-weight: 600; }
.admin-muted { padding: var(--space-4) 0; color: var(--color-text-secondary); text-align: center; }

.admin-confirm-field { display: grid; gap: var(--space-1); color: var(--color-text-secondary); }
.admin-confirm-input { width: 100%; }
.bulk-failures ul { margin: var(--space-1) 0 0; padding-left: var(--space-5); }

@media (width < 768px) {
  .admin-page { padding-block: var(--space-3) var(--space-10); }
  .admin-filter { flex: 1 1 100%; }
  .admin-filter :is(input, select) { flex: 1 1 auto; }
  .detail-row { flex-direction: column; gap: 0; }
}
</style>
