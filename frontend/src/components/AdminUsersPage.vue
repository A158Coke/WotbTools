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
import * as api from '../api/admin-users.js'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import AdminBulkBar from './AdminBulkBar.vue'
import AdminDangerZone from './AdminDangerZone.vue'
import AdminDetailDrawer from './AdminDetailDrawer.vue'
import AdminFilterBar from './AdminFilterBar.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import SegmentedControl from './SegmentedControl.vue'
import { isRowControlClick, rowOpenTarget } from './adminListRow'
import './admin-list.css'

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
// 跳页输入是 UI 页码（1-based）；只有合法的 1..totalPages 才转换成后端 0-based page。
const jumpPage = ref('')
// segment=keycloak（Keycloak 权威）| segment=local（本地 user_profile 权威）。
const segment = ref('keycloak')
const idpAlias = ref('')
// 详情抽屉：点行立即打开，先显示列表行自带的字段；Keycloak 仍存在的用户再补拉详情（detailUser）。
// 删除只在抽屉底部（AdminDangerZone，输入 DELETE），目标就是抽屉里这一行。
const detailRow = ref(null)
const detailUser = ref(null)
const detailReturnFocus = ref(null)
const dangerZone = ref(null)
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

/**
 * segment=keycloak|local：页头的受控分段（:model-value = 已应用状态）。门禁不通过时不推进已应用值，
 * 分段仍显示上一次真正生效的数据源，绝不出现「显示本地资料、行还是 Keycloak」的假 applied 状态。
 */
function onSegmentChange(value) {
  if (value === segment.value || !requireAdminUsersOnline()) return
  segment.value = value
  if (segment.value !== 'keycloak') idpAlias.value = ''
  reloadFirstPage()
}

const segmentOptions = computed(() => [
  { value: 'keycloak', label: t('admin.segmentKeycloak'), testid: 'admin-segment-keycloak', disabled: !adminAvailability.value.available },
  { value: 'local', label: t('admin.segmentLocal'), testid: 'admin-segment-local', disabled: !adminAvailability.value.available },
])

function onIdpAliasChange() {
  reloadFirstPage()
}

/** 小屏筛选 chip：只有 IdP 别名一项（数据源在页头，不算筛选）。 */
const filterChips = computed(() => (segment.value === 'keycloak' && idpAlias.value.trim()
  ? [{ key: 'idpAlias', label: `${t('admin.idpAlias')}: ${idpAlias.value.trim()}` }]
  : []))

function removeFilterChip(key) {
  if (key !== 'idpAlias') return
  idpAlias.value = ''
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

/** 跳页目标：只有 1..totalPages 的整数合法（空值 / 非整数 / 越界返回 null，调用方据此不发请求）。 */
function jumpTargetPage(raw, total) {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= total ? value : null
}

/**
 * 直接跳页：UI 1-based → 后端 0-based。
 * 门禁先于状态变更（与 search / segment / size 同一约定）：非-online 时不改已应用页码、不发请求；
 * 选择集清空沿用 goPage() 内的 clearSelection()。
 */
function goJumpPage() {
  const target = jumpTargetPage(jumpPage.value, totalPages.value)
  if (target == null || target - 1 === page.value) return
  if (!requireAdminUsersOnline()) return
  jumpPage.value = ''
  goPage(target - 1)
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

/**
 * 点行 / 行的打开按钮：抽屉立即打开并显示列表行字段；Keycloak 已删除的用户没有详情可拉，
 * 抽屉只显示行字段与说明（删除仍可用，与原来「查看禁用、删除可用」一致）。
 * 详情请求走门禁：非-online 时不发 adminGetUser。
 */
function openDetail(u, event) {
  detailLoadGeneration += 1
  detailReturnFocus.value = event ? rowOpenTarget(event) : null
  detailRow.value = u
  detailUser.value = null
  deleteResult.value = ''
  deleting.value = false
  dangerZone.value?.reset()
  if (!u.keycloakUserMissing) loadDetail(u)
}

function onRowClick(u, event) {
  if (!isRowControlClick(event)) openDetail(u, event)
}

async function loadDetail(u) {
  if (!requireAdminUsersOnline()) return
  const generation = ++detailLoadGeneration
  try {
    const result = await api.adminGetUser(u.keycloakUserId)
    if (generation === detailLoadGeneration) detailUser.value = result
  } catch (e) {
    if (generation === detailLoadGeneration) showError(apiError(e))
  }
}

function closeDetail() {
  // 删除请求在途时不关（与原确认框同一约定）：结果要能被看到，且不允许在途中换目标。
  if (deleting.value) return
  detailLoadGeneration += 1
  detailRow.value = null
  detailUser.value = null
  deleteResult.value = ''
}

let deleteCloseTimer = null
onBeforeUnmount(() => {
  userLoadGeneration += 1
  detailLoadGeneration += 1
  clearTimeout(deleteCloseTimer)
})

async function confirmDelete() {
  // TOCTOU：抽屉可以在「在线」时打开、在「离线」后才确认，所以判定必须放在
  // 真正的 API boundary（而不是只放在打开抽屉时）；否则离线时仍会发出破坏性请求。
  if (!requireAdminUsersOnline()) return
  const target = detailRow.value?.keycloakUserId
  if (!target || deleteResult.value === 'DELETED') return
  deleting.value = true
  deleteResult.value = ''
  try {
    // 单条删除就是长度为 1 的列表：与多选删除走同一个端点。
    const res = await api.adminDeleteUsers([target], true)
    const item = (res?.results || []).find(r => r.userId === target)
    deleteResult.value = item?.deleted ? 'DELETED' : apiError({ code: item?.errorCode || 'UNKNOWN_ERROR' })
    deleteCloseTimer = setTimeout(() => {
      if (detailRow.value?.keycloakUserId === target) closeDetail()
      loadUsers()
    }, 1200)
  } catch (e) {
    deleteResult.value = apiError(e)
  } finally { deleting.value = false }
}

/** 行主列：展示名 → Keycloak 用户名 → Keycloak ID（Keycloak 数据源的用户通常没有本地展示名）。 */
function rowName(u) {
  return u.displayName || u.keycloakUsername || u.keycloakUserId || t('admin.unknownUser')
}

/** 绑定 / 状态徽标：Keycloak 已删除 > 无本地资料 > 未绑定游戏账号 > 已绑定。 */
function rowState(u) {
  if (u.keycloakUserMissing) return { label: t('admin.kcUserMissing'), tone: 'is-warning' }
  if (!u.hasLocalProfile) return { label: t('admin.noLocalProfile'), tone: '' }
  // 本地资料在登录时即创建；真正的「绑定」是游戏账号（wotbAccountId），与个人资料页同一判据
  if (u.wotbAccountId == null) return { label: t('admin.unbound'), tone: '' }
  return { label: t('admin.bound'), tone: 'is-success' }
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
  <div class="admin-page admin-users">
    <ShowcaseHero compact section="admin" :kicker="$t('admin.kicker')" :title="$t('admin.title')">
      <template #actions>
        <SegmentedControl
          :model-value="segment"
          :options="segmentOptions"
          :aria-label="$t('admin.segment')"
          class="admin-segment"
          @update:model-value="onSegmentChange"
        />
      </template>
    </ShowcaseHero>

    <!-- 非-online 的中性状态（不是错误态）：文案来自 capability 模型，四态各有措辞。
         已加载的列表 / 搜索条件 / 选择集一律保留，只是新的 ONLINE_REQUIRED 动作被挡住。 -->
    <p
      v-if="!adminAvailability.pending && !adminAvailability.available"
      class="admin-list-status"
      data-testid="admin-connectivity-unavailable"
    >{{ $t(adminAvailability.messageKey) }}</p>

    <AdminFilterBar :chips="filterChips" @remove="removeFilterChip">
      <template #search>
        <input
          v-model="searchQuery"
          type="search"
          class="admin-list-input admin-search-input"
          data-testid="admin-search-input"
          :aria-label="$t('admin.searchLabel')"
          :placeholder="$t('admin.search')"
          @keyup.enter="onSearch"
        />
      </template>
      <label class="admin-list-field admin-idp-field">
        <span>{{ $t('admin.idpAlias') }}</span>
        <!-- idpAlias 是**草稿**输入：非-online 时允许继续编辑（回车不生效），不会被当成已应用条件。 -->
        <input
          v-model="idpAlias"
          class="admin-list-input"
          data-testid="admin-idp-input"
          :disabled="segment !== 'keycloak'"
          :placeholder="$t('admin.idpAliasPlaceholder')"
          @keyup.enter="onIdpAliasChange"
        />
      </label>
      <p v-if="segment !== 'keycloak'" class="admin-list-muted admin-filter-hint">{{ $t('admin.idpAliasKeycloakOnly') }}</p>
      <template #actions>
        <AppButton variant="primary" class="admin-search-btn" data-testid="admin-search-btn" :disabled="!adminAvailability.available" @click="onSearch">{{ $t('admin.searchBtn') }}</AppButton>
      </template>
    </AdminFilterBar>

    <AdminBulkBar v-if="selectedCount" :summary="$t('admin.selectedCount', { count: selectedCount })" :hint="$t('adminList.bulkScope')">
      <AppButton variant="ghost" size="sm" data-testid="admin-clear-selection" @click="clearSelection">{{ $t('admin.clearSelection') }}</AppButton>
      <AppButton variant="danger" size="sm" data-testid="admin-bulk-delete" :disabled="!adminAvailability.available" @click="startBulkDelete">{{ $t('admin.bulkDelete') }}</AppButton>
    </AdminBulkBar>

    <p v-if="loading" class="admin-list-empty" role="status">{{ $t('admin.loading') }}</p>

    <div v-if="!loading && users.length" class="admin-list-table-wrap">
      <table class="admin-list-table admin-table">
        <thead>
          <tr>
            <th class="cell-check">
              <label class="admin-list-check">
                <input
                  type="checkbox"
                  :checked="allPageSelected"
                  :aria-label="$t('admin.selectAllPage')"
                  @change="toggleSelectAllPage($event.target.checked)"
                />
                <span class="admin-list-check-label" aria-hidden="true">{{ $t('admin.selectAllPage') }}</span>
              </label>
            </th>
            <th>{{ $t('admin.colDisplayName') }}</th>
            <th>{{ $t('admin.colNickname') }}</th>
            <th>{{ $t('admin.colServer') }}</th>
            <th class="is-num">{{ $t('admin.colAccountId') }}</th>
            <th>{{ $t('admin.colState') }}</th>
            <th>{{ $t('admin.colKcUser') }}</th>
            <th>{{ $t('admin.colKcId') }}</th>
            <th>{{ $t('admin.colCreated') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in users"
            :key="u.keycloakUserId || u.profileId"
            class="is-clickable has-check"
            :class="{ 'is-selected': selectedSet.has(u.keycloakUserId), 'is-active': detailRow === u }"
            @click="onRowClick(u, $event)"
          >
            <td class="cell-check">
              <label class="admin-list-check">
                <input
                  type="checkbox"
                  :checked="selectedSet.has(u.keycloakUserId)"
                  :aria-label="$t('admin.selectRow', { name: u.keycloakUsername || u.keycloakUserId })"
                  @change="toggleSelect(u, $event.target.checked)"
                />
              </label>
            </td>
            <td class="cell-primary">
              <button type="button" class="admin-list-open" data-testid="admin-row-open" @click="openDetail(u, $event)">{{ rowName(u) }}</button>
            </td>
            <td :data-label="$t('admin.colNickname')">{{ u.wotbNickname || '—' }}</td>
            <td :data-label="$t('admin.colServer')">{{ u.wotbServer || '—' }}</td>
            <td class="is-num" :data-label="$t('admin.colAccountId')">{{ u.wotbAccountId ?? '—' }}</td>
            <td :data-label="$t('admin.colState')"><span class="admin-list-badge" :class="rowState(u).tone">{{ rowState(u).label }}</span></td>
            <td :data-label="$t('admin.colKcUser')">
              <span>{{ u.keycloakUsername || '—' }}</span>
              <span class="admin-list-muted admin-kc-email">{{ u.keycloakEmail || '—' }}</span>
            </td>
            <td :data-label="$t('admin.colKcId')"><span class="admin-list-mono admin-list-truncate cell-mono">{{ u.keycloakUserId }}</span></td>
            <td class="admin-list-muted" :data-label="$t('admin.colCreated')">{{ fmtTime(u.profileCreatedAt) || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="admin-list-empty">{{ $t('admin.empty') }}</p>

    <div v-if="totalPages > 0" class="admin-list-pagination admin-pagination">
      <span class="admin-page-info">{{ $t('admin.pageInfo', { page: page + 1, total: totalPages, items: totalItems }) }}</span>
      <div class="admin-list-pagination-controls">
        <AppButton size="sm" class="admin-page-prev" :disabled="page <= 0 || !adminAvailability.available" @click="goPage(page - 1)">{{ $t('admin.prev') }}</AppButton>
        <AppButton size="sm" class="admin-page-next" :disabled="page + 1 >= totalPages || !adminAvailability.available" @click="goPage(page + 1)">{{ $t('admin.next') }}</AppButton>
        <span v-if="totalPages > 1" class="admin-page-jump">
          <input
            v-model="jumpPage"
            type="number"
            inputmode="numeric"
            min="1"
            :max="totalPages"
            step="1"
            class="admin-list-input"
            :disabled="!adminAvailability.available"
            :aria-label="$t('admin.jumpLabel')"
            :placeholder="$t('admin.jumpPlaceholder')"
            @keydown.enter.prevent="goJumpPage"
          />
          <AppButton size="sm" class="admin-page-go" :disabled="!adminAvailability.available" @click="goJumpPage">{{ $t('admin.jumpGo') }}</AppButton>
        </span>
        <label>
          <span>{{ $t('admin.size') }}</span>
          <!-- 受控 select + data-applied-value：非-online 时回滚，避免「每页显示 50 但表格还是 25 条」。 -->
          <select
            class="admin-list-input admin-size-select"
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
    </div>

    <!-- 详情抽屉（右侧 AppSheet：焦点陷阱 / Esc / 关闭后焦点回到该行的打开按钮）；删除在抽屉底部 -->
    <AdminDetailDrawer :open="!!detailRow" :title="$t('admin.detail')" :return-focus-to="detailReturnFocus" class="admin-user-drawer" @close="closeDetail">
      <template v-if="detailRow">
        <div class="admin-user-identity">
          <span class="admin-user-avatar" aria-hidden="true">{{ rowName(detailRow).slice(0, 1).toUpperCase() }}</span>
          <div>
            <strong class="admin-user-name">{{ rowName(detailRow) }}</strong>
            <p class="admin-list-muted admin-user-state">{{ rowState(detailRow).label }}</p>
          </div>
        </div>
        <p v-if="detailRow.keycloakUserMissing" class="admin-list-warn admin-detail-unavailable">{{ $t('admin.detailUnavailable') }}</p>
        <section v-if="!detailUser" class="admin-list-section" data-testid="admin-detail-row">
          <h3 class="admin-list-section-title">{{ $t('admin.listSection') }}</h3>
          <dl class="admin-list-dl">
            <dt>{{ $t('admin.colKcId') }}</dt><dd class="admin-list-mono">{{ detailRow.keycloakUserId || '—' }}</dd>
            <dt>{{ $t('admin.username') }}</dt><dd>{{ detailRow.keycloakUsername || '—' }}</dd>
            <dt>{{ $t('admin.email') }}</dt><dd>{{ detailRow.keycloakEmail || '—' }}</dd>
            <dt>{{ $t('admin.colId') }}</dt><dd>{{ detailRow.profileId ?? '—' }}</dd>
            <dt>{{ $t('admin.colAccountId') }}</dt><dd>{{ detailRow.wotbAccountId ?? '—' }}</dd>
            <dt>{{ $t('admin.colNickname') }}</dt><dd>{{ detailRow.wotbNickname || '—' }}</dd>
            <dt>{{ $t('admin.colServer') }}</dt><dd>{{ detailRow.wotbServer || '—' }}</dd>
            <dt>{{ $t('admin.colCreated') }}</dt><dd>{{ fmtTime(detailRow.profileCreatedAt) || '—' }}</dd>
          </dl>
        </section>
        <template v-else>
          <section v-if="detailUser.profile" class="admin-list-section" data-testid="admin-detail-profile">
            <h3 class="admin-list-section-title">{{ $t('admin.profileSection') }}</h3>
            <dl class="admin-list-dl">
              <dt>{{ $t('admin.colId') }}</dt><dd>{{ detailUser.profile.id }}</dd>
              <dt>{{ $t('admin.colDisplayName') }}</dt><dd>{{ detailUser.profile.displayName }}</dd>
              <dt>{{ $t('admin.colAccountId') }}</dt><dd>{{ detailUser.profile.wotbAccountId }}</dd>
              <dt>{{ $t('admin.colNickname') }}</dt><dd>{{ detailUser.profile.wotbNickname }}</dd>
              <dt>{{ $t('admin.colServer') }}</dt><dd>{{ detailUser.profile.wotbServer }}</dd>
              <dt>{{ $t('admin.colCreated') }}</dt><dd>{{ fmtTime(detailUser.profile.createdAt) }}</dd>
            </dl>
          </section>
          <section v-if="detailUser.keycloak" class="admin-list-section" data-testid="admin-detail-keycloak">
            <h3 class="admin-list-section-title">{{ $t('admin.keycloak') }}</h3>
            <dl class="admin-list-dl">
              <dt>{{ $t('admin.colId') }}</dt><dd class="admin-list-mono">{{ detailUser.keycloak.id }}</dd>
              <dt>{{ $t('admin.username') }}</dt><dd>{{ detailUser.keycloak.username }}</dd>
              <dt>{{ $t('admin.email') }}</dt><dd>{{ detailUser.keycloak.email }}</dd>
              <dt>{{ $t('admin.enabled') }}</dt><dd>{{ detailUser.keycloak.enabled }}</dd>
              <template v-for="fi in (detailUser.keycloak.federatedIdentities || [])" :key="fi.userId">
                <dt>{{ fi.identityProvider }}</dt>
                <dd>{{ fi.userName }} ({{ fi.userId }})</dd>
              </template>
            </dl>
          </section>
          <p v-if="detailUser.warnings?.length" class="admin-list-warn">{{ detailUser.warnings.map(warning => apiErrorLabel(t, te, { code: warning })).join(', ') }}</p>
        </template>
      </template>
      <template #footer>
        <AdminDangerZone
          ref="dangerZone"
          :action-label="$t('admin.deleteUser')"
          :confirm-label="deleting ? $t('admin.deleting') : $t('admin.delete')"
          :hint="$t('admin.deleteHint')"
          :message="`${$t('admin.confirmText')} ${$t('admin.confirmWarn')}`"
          keyword="DELETE"
          :keyword-label="$t('admin.confirmInput')"
          :busy="deleting"
          :disabled="!adminAvailability.available || deleteResult === 'DELETED'"
          @confirm="confirmDelete"
        >
          <p v-if="deleteResult === 'DELETED'" class="admin-list-ok" role="status">{{ $t('admin.deleted') }}</p>
          <p v-else-if="deleteResult" class="admin-list-error" role="alert">{{ deleteResult }}</p>
        </AdminDangerZone>
      </template>
    </AdminDetailDrawer>

    <!-- 批量删除确认（整批只弹一次，输入 DELETE） -->
    <AppDialog
      :open="showBulkConfirm"
      :title="$t('admin.bulkConfirmDelete')"
      size="sm"
      tone="danger"
      class="bulk-confirm-modal"
      @close="!bulkDeleting && cancelBulkDelete()"
    >
      <div class="admin-bulk-confirm">
        <p>{{ $t('admin.bulkConfirmText', { count: selectedCount }) }}</p>
        <p class="admin-list-warn">{{ $t('admin.confirmWarn') }}</p>
        <template v-if="bulkResult">
          <p class="admin-list-ok">{{ $t('admin.bulkSummary', { requested: bulkResult.requested, deleted: bulkResult.deleted, failed: bulkResult.failed }) }}</p>
          <div v-if="bulkResult.results?.some(r => !r.deleted)" class="bulk-failures">
            <p class="admin-list-warn">{{ $t('admin.bulkFailures') }}</p>
            <ul>
              <li v-for="item in bulkResult.results.filter(r => !r.deleted)" :key="item.userId" class="admin-list-mono">
                {{ item.userId }} — {{ errorCodeLabel(item.errorCode) }}
              </li>
            </ul>
          </div>
        </template>
        <label v-else class="admin-list-field">
          <span>{{ $t('admin.confirmInput') }}</span>
          <input v-model="bulkConfirmText" :placeholder="$t('admin.deleteKeyword')" class="admin-list-input admin-confirm-input" autocomplete="off" />
        </label>
      </div>
      <template #actions>
        <AppButton variant="ghost" class="bulk-cancel" @click="cancelBulkDelete">{{ bulkResult ? $t('admin.close') : $t('admin.cancel') }}</AppButton>
        <AppButton
          v-if="!bulkResult"
          variant="danger"
          class="bulk-confirm"
          :disabled="bulkConfirmText !== 'DELETE' || bulkDeleting"
          :loading="bulkDeleting"
          @click="confirmBulkDelete"
        >
          {{ bulkDeleting ? $t('admin.deleting') : $t('admin.bulkDelete') }}
        </AppButton>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
/* 列表模板的共享样式在 admin-list.css；这里只放用户管理页自己的布局。 */
.admin-users { color: var(--color-text-primary); font: var(--type-body); }
.admin-search-input { flex: 1 1 auto; }
.admin-idp-field { min-width: var(--form-field-min); }
.admin-filter-hint { margin: 0; }
.admin-kc-email { display: block; }
.admin-page-jump { display: inline-flex; align-items: center; gap: var(--space-2); }

.admin-user-identity { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-5); }
.admin-user-avatar {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: var(--control-h-lg);
  height: var(--control-h-lg);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-2);
  color: var(--color-accent-text);
  font: var(--type-h3);
}
.admin-user-name { font: var(--type-h3); overflow-wrap: anywhere; }
.admin-user-state { margin: 0; }
.admin-detail-unavailable { margin: 0 0 var(--space-4); }

.admin-bulk-confirm { display: grid; gap: var(--space-2); }
.admin-bulk-confirm p { margin: 0; }
.bulk-failures ul { margin: var(--space-1) 0 0; padding-left: var(--space-5); }

@media (width < 768px) {
  .admin-idp-field { min-width: 0; }
}
</style>
