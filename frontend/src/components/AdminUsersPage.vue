<script setup>
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
const list = ref({
  query: { query: '', segment: 'keycloak', idpAlias: '', page: 0, size: 25 },
  users: [], totalItems: 0, totalPages: 0,
})
const applied = computed(() => list.value.query)
const users = computed(() => list.value.users)
const page = computed(() => applied.value.page)
const size = computed(() => applied.value.size)
const totalPages = computed(() => list.value.totalPages)
const totalItems = computed(() => list.value.totalItems)
const loading = ref(false)
let userLoadGeneration = 0

const { initPromise, ensureToken: ensureAuthToken, login } = useAuth()
const { availability, requireFeature } = useFeatureGate()
const { connectivity } = useConnectivity()

const { requireAdminUsersOnline, apiError, errorCodeLabel, ensureToken } = createAdminUsersGate({
  gate: () => requireFeature(Feature.ADMIN_USERS),
  initPromise, ensureAuthToken, login, t, te,
})

const blockedByConnectivity = ref(false)

const adminAvailability = computed(() => availability(Feature.ADMIN_USERS))
const removeDisabled = computed(() => loading.value || !adminAvailability.value.available)
const pageSizeOptions = computed(() => ['25', '50', '100'].map(value => ({
  value, label: value, disabled: !adminAvailability.value.available,
})))

onMounted(async () => {
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

watch(connectivity, () => {
  if (users.value.length || loading.value || !blockedByConnectivity.value) return
  if (!availability(Feature.ADMIN_USERS).available) return
  blockedByConnectivity.value = false
  loadUsers()
})

const {
  segment, idpAlias, searchQuery, onSearch, onSegmentChange, segmentOptions, filterChips, removeFilterChip,
} = useAdminUserFilters({ requireOnline: requireAdminUsersOnline, applied, reloadFirstPage, removeDisabled, adminAvailability, t })

const {
  selectedIds, selectedSet, selectedCount, allPageSelected,
  showBulkConfirm, bulkConfirmText, bulkDeleting, bulkResult,
  clearSelection, toggleSelect, toggleSelectAllPage, retainVisible,
  startBulkDelete, cancelBulkDelete, confirmBulkDelete,
} = useAdminUserSelection({
  users,
  canDelete: () => !loading.value && requireAdminUsersOnline(),
  loadUsers,
  showApiError: showError,
  errorText: apiError,
})

const {
  jumpPage, onSizeChange, goPage, jumpTargetPage, goJumpPage,
} = useAdminUserPagination({
  requireOnline: requireAdminUsersOnline, page, size, totalPages,
  requestPage: (page, size) => loadUsers({ ...applied.value, page, size }, true),
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

async function loadUsers(request = applied.value, resetSelection = false) {
  if (!requireAdminUsersOnline()) return false
  const generation = ++userLoadGeneration
  loading.value = true
  try {
    const { query, ...options } = request
    const res = await api.adminSearchUsers(query, options)
    if (generation !== userLoadGeneration) return false
    const lastPage = Math.max((res?.totalPages || 0) - 1, 0)
    if (request.page > lastPage) return await loadUsers({ ...request, page: lastPage }, true)
    list.value = { query: request, users: res?.items ?? [], totalItems: res?.totalItems ?? 0, totalPages: res?.totalPages ?? 0 }
    if (resetSelection) clearSelection()
    else retainVisible()
    return true
  } catch (e) {
    if (generation === userLoadGeneration) showError(apiError(e))
    return false
  } finally {
    if (generation === userLoadGeneration) loading.value = false
  }
}

function reloadFirstPage(filters) {
  return loadUsers({ ...applied.value, ...filters, page: 0 }, true)
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

    <p
      v-if="!adminAvailability.pending && !adminAvailability.available"
      class="admin-list-status"
      data-testid="admin-connectivity-unavailable"
    >{{ $t(adminAvailability.messageKey) }}</p>

    <AdminFilterBar :chips="filterChips" :remove-disabled="removeDisabled" @remove="removeFilterChip">
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
        <input
          v-model="idpAlias"
          class="admin-list-input"
          data-testid="admin-idp-input"
          :disabled="segment !== 'keycloak'"
          :placeholder="$t('admin.idpAliasPlaceholder')"
          @keyup.enter="onSearch"
        />
      </label>
      <p v-if="segment !== 'keycloak'" class="admin-list-muted admin-filter-hint">{{ $t('admin.idpAliasKeycloakOnly') }}</p>
      <template #actions>
        <AppButton variant="primary" class="admin-search-btn" data-testid="admin-search-btn" :disabled="!adminAvailability.available" @click="onSearch">{{ $t('admin.searchBtn') }}</AppButton>
      </template>
    </AdminFilterBar>

    <AdminBulkBar v-if="selectedCount" :summary="$t('admin.selectedCount', { count: selectedCount })" :hint="$t('adminList.bulkScope')">
      <AppButton variant="ghost" size="sm" data-testid="admin-clear-selection" @click="clearSelection">{{ $t('admin.clearSelection') }}</AppButton>
      <AppButton variant="danger" size="sm" data-testid="admin-bulk-delete" :disabled="loading || !adminAvailability.available" @click="startBulkDelete">{{ $t('admin.bulkDelete') }}</AppButton>
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
        <div class="admin-list-field">
          <span>{{ $t('admin.size') }}</span>
          <SegmentedControl :model-value="String(size)" :options="pageSizeOptions" :aria-label="$t('admin.size')"
            data-testid="admin-page-size" @update:model-value="onSizeChange" />
        </div>
      </div>
    </div>

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
.admin-users { color: var(--color-text-primary); font: var(--type-body); }
.admin-search-input { flex: 1 1 auto; }
.admin-table th { position: static; }
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
