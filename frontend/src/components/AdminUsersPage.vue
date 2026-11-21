<script setup>
/**
 * Admin 用户管理页（Keycloak + 本地 user_profile 聚合）。
 * 分页 / 筛选分段 / 选择集与批量删除 / 详情抽屉与删除流拆分至 admin-users/
 * （LOC 预算；行为原样）。门禁 → 认证 → backend 的唯一顺序约定见 requireAdminUsersOnline。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectivity } from '../composables/useConnectivity.js'
import { useAuth } from '../composables/useAuth.js'
import { useError } from '../composables/useError.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
import * as api from '../api/admin-users.js'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import AdminBulkBar from './AdminBulkBar.vue'
import AdminDangerZone from './AdminDangerZone.vue'
import AdminDetailDrawer from './AdminDetailDrawer.vue'
import AdminFilterBar from './AdminFilterBar.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import SegmentedControl from './SegmentedControl.vue'
import { isRowControlClick } from './adminListRow'
import { useAdminUserFilters } from './admin-users/useAdminUserFilters.ts'
import { useAdminUserPagination } from './admin-users/useAdminUserPagination.ts'
import { useAdminUserSelection } from './admin-users/useAdminUserSelection.ts'
import { useAdminUserDetail } from './admin-users/useAdminUserDetail.ts'
import { createAdminUsersGate } from './admin-users/adminUsersGate.ts'
import { apiErrorLabel } from '../utils/display.js'
import { createAdminUsersRowPresenter } from './admin-users/adminUsersRow.ts'
import './admin-list.css'

const { t, te } = useI18n()
const { rowName, rowState, fmtTime } = createAdminUsersRowPresenter(t)
const { show: showError } = useError()
const users = ref([])
const loading = ref(false)
const searchQuery = ref('')
let userLoadGeneration = 0

const { initPromise, ensureToken: ensureAuthToken, login } = useAuth()
const { availability, requireFeature } = useFeatureGate()
const { connectivity } = useConnectivity()

// 门禁 → 认证（ensureToken / login） → backend：非-online 时先被门禁挡住，绝不发 admin API。
// 门禁/认证细节见 admin-users/adminUsersGate.ts（PR 467 review blocker 的顺序约定）。
const { requireAdminUsersOnline, apiError, errorCodeLabel, ensureToken } = createAdminUsersGate({
  gate: () => requireFeature(Feature.ADMIN_USERS),
  initPromise, ensureAuthToken, login, t, te,
})

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

const {
  segment, idpAlias, onSegmentChange, segmentOptions, onIdpAliasChange, filterChips, removeFilterChip,
} = useAdminUserFilters({ requireOnline: requireAdminUsersOnline, reloadFirstPage, adminAvailability, t })

const {
  selectedIds, selectedSet, selectedCount, allPageSelected,
  showBulkConfirm, bulkConfirmText, bulkDeleting, bulkResult,
  clearSelection, toggleSelect, toggleSelectAllPage, retainVisible,
  startBulkDelete, cancelBulkDelete, confirmBulkDelete,
} = useAdminUserSelection({
  users,
  requireOnline: requireAdminUsersOnline,
  loadUsers,
  showApiError: showError,
  errorText: apiError,
})

const {
  page, size, totalItems, totalPages, jumpPage, onSizeChange, goPage, jumpTargetPage, goJumpPage,
} = useAdminUserPagination({
  requireOnline: requireAdminUsersOnline,
  clearSelection,
  loadUsers,
  reloadFirstPage,
})

const {
  detailRow, detailUser, detailReturnFocus, dangerZone, deleting, deleteResult,
  openDetail, onRowClick, closeDetail, confirmDelete, dispose: disposeDetail,
} = useAdminUserDetail({
  requireOnline: requireAdminUsersOnline,
  loadUsers,
  showError,
  apiError,
  isRowControlClick,
})

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
    retainVisible()
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

onBeforeUnmount(() => {
  userLoadGeneration += 1
  disposeDetail()
})

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
