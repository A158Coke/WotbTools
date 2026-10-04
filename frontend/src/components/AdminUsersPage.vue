<script setup>
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { useConnectivity } from '../composables/useConnectivity.js'
import { useError } from '../composables/useError.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
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
const { availability, requireFeature } = useFeatureGate()
const { connectivity } = useConnectivity()

/**
 * 本页所有 backend 动作的**唯一**门禁（PR 467 review blocker）。
 *
 * 用户管理整页都是 Keycloak Admin + 本地 user_profile 的聚合，没有任何可离线的本地投影，
 * 因此整体是 ONLINE_REQUIRED —— 但判定只能来自 capability SSOT（`useFeatureGate`），
 * 页面**不写** `connectivity === 'online'`、也不读 `navigator.onLine`：
 *
 * ```text
 * 门禁 → 认证（ensureToken / login） → backend
 * ```
 *
 * 顺序很关键：非-online 时**先**被门禁挡住，所以既不会触发 `login()` 跳转、也不会走 token
 * refresh 的失败路径，更不会发出 admin API 请求（`adminSearchUsers` / `adminGetUser` /
 * `adminDeleteUsers` 调用数恒为 0），用户立刻看到统一 connectivity notice。
 *
 * 已缓存的过期 admin session 仍然保留 claims/role（见 useAuth 的本地投影），因此「Admin Users」
 * 入口继续可见；只是这个页面在离线时不能登录、不能请求 backend。
 */
function requireAdminUsersOnline() {
  return requireFeature(Feature.ADMIN_USERS)
}

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

/** 首次被门禁挡下的加载：只有「确实什么都没加载过」才允许 reconnect 自动补一次。 */
const blockedByConnectivity = ref(false)

/** 当前 capability 判定（页面只读它渲染中性提示，不据此自己拼文案；四态措辞由模型决定）。 */
const adminAvailability = computed(() => availability(Feature.ADMIN_USERS))

onMounted(async () => {
  // 门禁先于认证：非-online 时既不 ensureToken（不发 token refresh）、也不 login()、也不请求 backend。
  if (!requireAdminUsersOnline()) {
    blockedByConnectivity.value = true
    return
  }
  try {
    await ensureToken()
    loadUsers()
  } catch (e) {
    showError(apiError(e))
  }
})

/**
 * 恢复在线后，只补「因为离线从来没加载过」的列表，且只补一次：
 *  - 已加载过的数据 / 搜索条件 / 分页 / 选择集原样保留，掉线不清空；
 *  - **不**重放任何破坏性动作（删除 / 批量删除）或上一次详情 / 搜索，用户的下一次点击才算数；
 *  - `loading` + 一次性 flag 双重去重，重复 online 通知不会形成请求风暴。
 */
watch(connectivity, () => {
  if (users.value.length || loading.value || !blockedByConnectivity.value) return
  if (!availability(Feature.ADMIN_USERS).available) return
  blockedByConnectivity.value = false
  loadUsers()
})

function clearSelection() {
  selectedIds.value = []
}

async function loadUsers() {
  // 门禁在所有 backend 入口的第一行：搜索 / 换 segment / 换 IdP / 换页长 / 翻页 / 删除后 reload
  // 都只经过这一个函数，因此非-online 时 adminSearchUsers 调用数恒为 0。
  if (!requireAdminUsersOnline()) return
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
/**
 * 会改变「已应用查询」的动作一律**先门禁、后改状态**（review P2）。
 *
 * 之前的顺序是「先 mutation，再由 loadUsers 里的门禁挡下」，非-online 时会出现
 * 「page/segment/size 已经变了、rows 还是上一次的结果」的不一致状态。这里的顺序约定是：
 *
 * ```text
 * 门禁 → 改 applied 状态（page/size/segment/selection） → loadUsers() 发请求
 * ```
 *
 * `loadUsers()` 内部仍保留一次门禁：它还有别的调用方（删除后 reload、reconnect 自动补一次），
 * 那些路径不能绕过准入。v-model 的 select 另有 handler 级回滚兜底（见模板）。
 */
function reloadFirstPage() {
  if (!requireAdminUsersOnline()) return
  clearSelection()
  page.value = 0
  loadUsers()
}

function onSearch() {
  reloadFirstPage()
}

/** segment=keycloak|local：门禁不通过时把 select 的改动回滚成已应用值（data-applied-value）。 */
function onSegmentChange(event) {
  if (!requireAdminUsersOnline()) {
    if (event?.target) event.target.value = event.target.dataset.appliedValue
    return
  }
  // 已应用状态由事件携带的新值推进（select 是 server-backed，没有本地降级语义）。
  segment.value = event?.target?.value ?? segment.value
  if (segment.value !== 'keycloak') idpAlias.value = ''
  reloadFirstPage()
}

function onIdpAliasChange() {
  reloadFirstPage()
}

/** 每页数量：同上，未通过门禁（或值非法）时保持已应用的 size。 */
function onSizeChange(event) {
  const next = Number(event?.target?.value)
  if (!requireAdminUsersOnline() || !Number.isFinite(next)) {
    if (event?.target) event.target.value = event.target.dataset.appliedValue
    return
  }
  size.value = next
  reloadFirstPage()
}

function goPage(nextPage) {
  if (!requireAdminUsersOnline()) return
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
  if (!requireAdminUsersOnline()) return
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
  // TOCTOU：删除对话框可以在「在线」时打开、在「离线」后才确认，所以判定必须放在
  // 真正的 API boundary（而不是只放在 startDelete）；否则离线时仍会发出破坏性请求。
  if (!requireAdminUsersOnline()) return
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
  // 同单个删除的 TOCTOU：批量确认框可能跨过一次掉线，因此在最后的执行边界再判一次，
  // 非-online 时 adminDeleteUsers 一次都不发。
  if (!requireAdminUsersOnline()) return
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

    <!-- 非-online 的中性状态（不是错误态）：文案来自 capability 模型，四态各有措辞。
         已加载的列表 / 搜索条件 / 选择集一律保留，只是新的 ONLINE_REQUIRED 动作被挡住。 -->
    <p
      v-if="!adminAvailability.pending && !adminAvailability.available"
      class="admin-connectivity"
      data-testid="admin-connectivity-unavailable"
    >{{ $t(adminAvailability.messageKey) }}</p>

    <div class="admin-search">
      <input v-model="searchQuery" :placeholder="$t('admin.search')" @keyup.enter="onSearch" />
      <button type="button" class="admin-search-btn" :disabled="!adminAvailability.available" @click="onSearch">{{ $t('admin.searchBtn') }}</button>
    </div>

    <div class="admin-filters">
      <label class="admin-filter">
        <span>{{ $t('admin.segment') }}</span>
        <!-- 受控 select（:value = 已应用状态）+ data-applied-value：门禁不通过时把改动回滚，
             绝不出现「select 显示 local 但 rows 还是 keycloak」的假 applied 状态。 -->
        <select
          :value="segment"
          :data-applied-value="segment"
          :disabled="!adminAvailability.available"
          @change="onSegmentChange"
        >
          <option value="keycloak">{{ $t('admin.segmentKeycloak') }}</option>
          <option value="local">{{ $t('admin.segmentLocal') }}</option>
        </select>
      </label>
      <label class="admin-filter">
        <span>{{ $t('admin.idpAlias') }}</span>
        <!-- idpAlias 是**草稿**输入：非-online 时允许继续编辑（回车不生效），不会被当成已应用条件。 -->
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
      <button class="btn-sm btn-danger" :disabled="!adminAvailability.available" @click="startBulkDelete">{{ $t('admin.bulkDelete') }}</button>
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
                :disabled="u.keycloakUserMissing || !adminAvailability.available"
                :title="u.keycloakUserMissing ? $t('admin.detailUnavailable') : ''"
                @click="loadDetail(u)"
              >{{ $t('admin.view') }}</button>
              <button type="button" class="btn-sm btn-danger" :disabled="!adminAvailability.available" @click="startDelete(u)">{{ $t('admin.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="admin-muted">{{ $t('admin.empty') }}</p>

    <div v-if="totalPages > 0" class="admin-pagination">
      <button class="btn-sm" :disabled="page <= 0 || !adminAvailability.available" @click="goPage(page - 1)">{{ $t('admin.prev') }}</button>
      <span class="admin-page-info">{{ $t('admin.pageInfo', { page: page + 1, total: totalPages, items: totalItems }) }}</span>
      <button class="btn-sm" :disabled="page + 1 >= totalPages || !adminAvailability.available" @click="goPage(page + 1)">{{ $t('admin.next') }}</button>
      <label class="admin-filter">
        <span>{{ $t('admin.size') }}</span>
        <!-- 受控 select（同 segment）：非-online 时回滚，避免「每页显示 50 但表格还是 25 条」。 -->
        <select
          :value="size"
          :data-applied-value="size"
          :disabled="!adminAvailability.available"
          @change="onSizeChange"
        >
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
.admin-search-btn:disabled { cursor: not-allowed; opacity: .5; }
.admin-page select:disabled { cursor: not-allowed; opacity: .5; }

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

/* 连通性中性提示：与 admin-muted 同一语气（不是 danger），只表达「现在拿不到远端数据」。 */
.admin-connectivity {
  margin: 0 0 var(--space-4);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
}

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
