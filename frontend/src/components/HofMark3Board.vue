<script setup lang="ts">
// 名人堂「三环」榜：筛选 / 分页 / 榜单行 / 个人三环状态（current / pending）/ 撤回的唯一 owner。
// URL query 归 HoFPage：本组件只在加载时 emit('query-change')，并通过 expose 的 queryState / applyQuery 收发。
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createReusableTemplate } from '@vueuse/core'
import { confirm } from '../composables/useConfirm.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { apiErrorLabel } from '../utils/display.js'
import { HUNDRED_VEHICLES } from '../utils/hundredVehicles.js'
import * as api from '../api/hall-of-fame.js'
import type { components } from '../api/generated/http-contract.js'
import { findVehicleStatus, fmtDate, formatHofNumber, formatHofWinRate, pageTotalItems, rankClass, scrollBoardIntoView, tierXPickerOption, uniqueValues, useHofAccess, useHofEpoch, vehicleChips, vehicleValueLabel as valueLabel, type HofQuery } from './hofBoardShared.js'
import FilterChips from './FilterChips.vue'
import AppSheet from './AppSheet.vue'
import AppButton from './AppButton.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import HofPager from './HofPager.vue'
import HofMark3SubmitDialog from './HofMark3SubmitDialog.vue'
import VehiclePicker from './VehiclePicker.vue'

type LeaderboardItem = components['schemas']['Mark3LeaderboardItem']
type SubmissionSummary = components['schemas']['Mark3SubmissionSummary']

defineProps<{ active?: boolean, filterOpen?: boolean, sheetTarget?: HTMLElement | null }>()
const emit = defineEmits<{ 'query-change': [], 'toggle-filters': [], 'close-filters': [] }>()

const { locale, t, te } = useI18n()
const { isCompact } = useBreakpoint()
const { hofAvailability, isAuthenticated, requireHofOnline } = useHofAccess()
const [DefineFilters, ReuseFilters] = createReusableTemplate()
const pane = ref<HTMLElement | null>(null)
const submitDialog = ref<InstanceType<typeof HofMark3SubmitDialog> | null>(null)

// 三环与百场共用 Tier X 车辆分类，但只允许人工证据审核。
const vehicles = HUNDRED_VEHICLES
const vehicleId = ref<number | null>(null)
const vehicleName = ref('')
const nation = ref('')
const vehicleType = ref('')
const rows = ref<LeaderboardItem[]>([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const totalPages = ref(0)
const totalItems = ref<number | null>(null)
const PAGE_SIZE = 50
let loadGeneration = 0
const currentEpoch = useHofEpoch(hofAvailability, () => {
  loadGeneration++
  loading.value = false
})

const currentList = ref<SubmissionSummary[]>([])
const pendingList = ref<SubmissionSummary[]>([])
const withdrawingId = ref<number | null>(null)
const msg = ref('')
const msgErr = ref(false)

const vehicleValueLabel = (value: string | null | undefined) => valueLabel(t, te, value)
const nations = uniqueValues(vehicles.map(vehicle => vehicle.nation))
const vehicleTypes = uniqueValues(vehicles.map(vehicle => vehicle.vehicleType))
const filteredVehicles = computed(() => vehicles.filter(vehicle =>
  (!nation.value || vehicle.nation === nation.value)
    && (!vehicleType.value || vehicle.vehicleType === vehicleType.value)))
const pickerOptions = computed(() => filteredVehicles.value.map(vehicle => tierXPickerOption(t, te, vehicle)))
const vehicleLabel = computed(() => (vehicleId.value ? vehicleName.value || `#${vehicleId.value}` : ''))
const selectedCurrent = computed(() => findVehicleStatus(currentList.value, vehicleId.value))
const selectedPending = computed(() => findVehicleStatus(pendingList.value, vehicleId.value))

async function loadList() {
  if (!hofAvailability.value.available) return
  const epoch = currentEpoch()
  emit('query-change')
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  try {
    const params = {
      page: page.value,
      size: PAGE_SIZE,
      nation: nation.value,
      vehicleType: vehicleType.value,
      vehicleId: vehicleId.value,
    }
    const res = await api.hofMark3List(params)
    if (epoch !== currentEpoch()) return
    if (generation !== loadGeneration) return
    rows.value = res.items || []
    totalPages.value = res.totalPages || 0
    totalItems.value = pageTotalItems(res)
  } catch (e) {
    if (epoch !== currentEpoch()) return
    if (generation === loadGeneration) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

// 个人三环状态仅在已登录时读取，匿名看榜单不会触发登录跳转。
async function loadStatus() {
  if (!hofAvailability.value.available) return
  const epoch = currentEpoch()
  if (!isAuthenticated()) {
    currentList.value = []
    pendingList.value = []
    return
  }
  try {
    const status = await api.hofMark3MyStatus()
    if (epoch !== currentEpoch()) return
    currentList.value = Array.isArray(status.current) ? status.current : []
    pendingList.value = Array.isArray(status.pending) ? status.pending : []
  } catch {
    if (epoch !== currentEpoch()) return
    currentList.value = []
    pendingList.value = []
  }
}

function loadAll() {
  loadList()
  loadStatus()
}

function reloadFirstPage() {
  msg.value = ''
  page.value = 1
  loadAll()
}

function onVehicleChange() {
  vehicleName.value = vehicles.find(item => item.id === Number(vehicleId.value))?.name || ''
  reloadFirstPage()
}

function onVehicleFilterChange() {
  if (vehicleId.value && !filteredVehicles.value.some(vehicle => vehicle.id === Number(vehicleId.value))) {
    vehicleId.value = null
    vehicleName.value = ''
  }
  reloadFirstPage()
}

function goPage(nextPage: number) {
  page.value = nextPage
  loadList()
  scrollBoardIntoView(pane)
}

async function onSubmitted() {
  msg.value = t('mark3.submitSuccess')
  msgErr.value = false
  await loadList()
  await loadStatus()
}

async function withdrawPending(submission: SubmissionSummary) {
  if (!requireHofOnline()) return
  if (withdrawingId.value) return
  if (!(await confirm({ title: t('mark3.withdrawConfirm'), confirmLabel: t('mark3.withdraw'), danger: true }))) return
  if (!requireHofOnline()) return
  withdrawingId.value = submission.id
  msg.value = ''
  try {
    await api.hofMark3Cancel(submission.id)
    await loadStatus()
    msg.value = t('mark3.withdrawSuccess')
    msgErr.value = false
  } catch (e) {
    msg.value = apiErrorLabel(t, te, e)
    msgErr.value = true
  } finally {
    withdrawingId.value = null
  }
}

const chips = computed(() => vehicleChips(t, te, nation.value, vehicleType.value, vehicleLabel.value))
function removeFilter(key: string) {
  if (key === 'nation') nation.value = ''
  if (key === 'type') vehicleType.value = ''
  if (key === 'vehicle') { vehicleId.value = null; return onVehicleChange() }
  onVehicleFilterChange()
}

defineExpose({
  queryState: () => ({ tab: 'mark3', page: page.value, tank: vehicleId.value, nation: nation.value, type: vehicleType.value }),
  applyQuery(q: HofQuery) {
    nation.value = q.nation
    vehicleType.value = q.type
    vehicleId.value = q.tank
    vehicleName.value = vehicles.find(v => v.id === q.tank)?.name || ''
    page.value = q.page
    loadAll()
  },
  activate: loadAll,
  reload: loadAll,
})
</script>

<template>
  <div ref="pane" class="h100-pane mark3-pane" data-hof-pane="mark3">
    <ShowcaseHero v-if="active" section="mark3" :kicker="$t('hof.btn')" :title="$t('mark3.tab')" :description="$t('mark3.subtitle')">
      <template v-if="totalItems != null" #stats><div><span class="lb-hero-stat-label">{{ $t('hof.heroTotal') }}</span><strong>{{ totalItems.toLocaleString(locale) }}</strong></div></template>
      <template #actions>
      <div class="lb-submit-row">
        <button type="button" class="filebtn h100-submit-btn mark3-submit-btn" data-tour="hof-submit"
                :disabled="!!selectedCurrent || !!selectedPending || loading" @click="submitDialog?.open(vehicleId)">
          <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg>{{ $t('mark3.submit') }}
        </button>
      </div>
      </template>
    </ShowcaseHero>

    <FilterChips data-tour="hof-filters" v-if="isCompact" :chips="chips" :open="filterOpen" @toggle="emit('toggle-filters')" @remove="removeFilter" />
    <DefineFilters>
    <div class="lb-toolbar-host" :data-tour="isCompact ? 'hof-filter-options' : 'hof-filters'" :class="{ 'is-sheet': isCompact }">
      <div v-if="isCompact" class="lb-sheet-head">
        <strong>{{ $t('filters.title') }}</strong>
        <AppButton variant="primary" data-testid="filter-done" @click="emit('close-filters')">{{ $t('filters.done') }}</AppButton>
      </div>
      <div class="lb-toolbar h100-toolbar">
      <label class="lb-limit mark3-filter"><span class="lb-label">{{ $t('mark3.nation') }}</span>
        <select v-model="nation" @change="onVehicleFilterChange">
          <option value="">{{ $t('mark3.allNations') }}</option>
          <option v-for="item in nations" :key="item" :value="item">{{ vehicleValueLabel(item) }}</option>
        </select>
      </label>
      <label class="lb-limit mark3-filter"><span class="lb-label">{{ $t('mark3.vehicleType') }}</span>
        <select v-model="vehicleType" @change="onVehicleFilterChange">
          <option value="">{{ $t('mark3.allVehicleTypes') }}</option>
          <option v-for="item in vehicleTypes" :key="item" :value="item">{{ vehicleValueLabel(item) }}</option>
        </select>
      </label>
      <div class="lb-limit mark3-vehicle-filter"><label class="lb-label" for="hof-mark3-vehicle">{{ $t('mark3.selectVehicle') }}</label>
        <VehiclePicker :model-value="vehicleId ?? undefined" @update:model-value="vehicleId = $event" class="mark3-vehicle-select" input-id="hof-mark3-vehicle"
                       :options="pickerOptions" :null-label="$t('mark3.default')" :fallback-label="vehicleLabel"
                       @change="onVehicleChange" />
      </div>
      <button type="button" class="ghost sm" :disabled="loading" @click="loadList">
        <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('hof.refresh') }}
      </button>
    </div>
    </div>
    </DefineFilters>
    <AppSheet v-if="isCompact" :portal-to="sheetTarget" :open="filterOpen" :title="$t('filters.title')" @close="emit('close-filters')"><ReuseFilters /></AppSheet>
    <ReuseFilters v-else />

    <p v-if="vehicleId && !isCompact" class="lb-filter-hint">
      {{ $t('mark3.selectVehicle') }}: <strong>{{ vehicleLabel }}</strong>
    </p>

    <div v-if="selectedCurrent" class="h100-pending-card mark3-current-card">
      <div class="h100-pending-body">
        <div class="h100-pending-title">{{ $t('mark3.currentTitle', { vehicle: selectedCurrent.vehicleName || vehicleName }) }}</div>
        <div class="h100-pending-meta">
          <span>{{ $t('mark3.currentBattles') }}: <strong>{{ formatHofNumber(selectedCurrent.approvedBattleCount ?? selectedCurrent.claimedBattleCount) }}</strong></span>
          <span>{{ $t('mark3.currentDamage') }}: <strong>{{ formatHofNumber(selectedCurrent.approvedAverageDamage ?? selectedCurrent.claimedAverageDamage) }}</strong></span>
          <span>{{ $t('mark3.currentWinRate') }}: <strong>{{ formatHofWinRate(selectedCurrent.approvedWinRate ?? selectedCurrent.claimedWinRate) }}</strong></span>
        </div>
      </div>
    </div>
    <div v-else-if="selectedPending" class="h100-pending-card">
      <div class="h100-pending-body">
        <div class="h100-pending-title">{{ $t('mark3.pendingTitle', { vehicle: selectedPending.vehicleName || vehicleName }) }}</div>
        <div class="h100-pending-meta">
          <span>{{ $t('mark3.pendingBattles') }}: <strong>{{ formatHofNumber(selectedPending.claimedBattleCount) }}</strong></span>
          <span>{{ $t('mark3.pendingDamage') }}: <strong>{{ formatHofNumber(selectedPending.claimedAverageDamage) }}</strong></span>
          <span>{{ $t('mark3.pendingWinRate') }}: <strong>{{ formatHofWinRate(selectedPending.claimedWinRate) }}</strong></span>
          <span class="h100-pending-time">{{ $t('mark3.pendingTime') }}: {{ fmtDate(selectedPending.submittedAt) || '-' }}</span>
        </div>
      </div>
      <button type="button" class="ghost sm danger" :disabled="withdrawingId === selectedPending.id" @click="withdrawPending(selectedPending)">
        {{ withdrawingId === selectedPending.id ? $t('mark3.withdrawing') : $t('mark3.withdraw') }}
      </button>
    </div>

    <p v-if="msg" class="lb-upload-msg" :class="{ err: msgErr }">{{ msg }}</p>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading && !rows.length" class="muted">{{ $t('mark3.loading') }}</p>
    <div v-else-if="!rows.length" class="lb-empty" data-testid="mark3-empty">
      <p class="lb-empty-title">{{ $t(vehicleId ? 'mark3.empty' : 'mark3.emptyDefault') }}</p>
      <p class="lb-empty-how">{{ $t('hofHowTo.mark3', { action: $t('mark3.submit') }) }}</p>
    </div>
    <div v-else-if="!isCompact" class="tablewrap" data-hof-board data-tour="hof-records" :class="{ 'is-stale': loading }" :aria-busy="loading">
      <table>
        <thead>
          <tr>
            <th>{{ $t('mark3.rank') }}</th>
            <th>{{ $t('mark3.vehicle') }}</th>
            <th>{{ $t('mark3.nickname') }}</th>
            <th>{{ $t('mark3.battleCount') }}</th>
            <th>{{ $t('mark3.avgDamage') }}</th>
            <th>{{ $t('mark3.winRate') }}</th>
            <th>{{ $t('mark3.approvedAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td><span class="rk" :class="rankClass(row.rank)">{{ row.rank }}</span></td>
            <td>{{ row.vehicleName }}</td>
            <td>{{ row.nickname }}</td>
            <td class="lb-dmg">{{ formatHofNumber(row.approvedBattleCount) }}</td>
            <td>{{ formatHofNumber(row.approvedAverageDamage) }}</td>
            <td>{{ formatHofWinRate(row.approvedWinRate) }}</td>
            <td class="lb-time">{{ fmtDate(row.approvedAt) || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ol v-else class="lb-cards" data-hof-board data-tour="hof-records" :class="{ 'is-stale': loading }" :aria-busy="loading" data-testid="mark3-cards">
      <li v-for="row in rows" :key="row.id" class="lb-card">
        <span class="rk" :class="rankClass(row.rank)">{{ row.rank }}</span>
        <div class="lb-card-main">
          <strong class="lb-card-name">{{ row.nickname }}</strong>
          <span class="lb-card-tank">{{ row.vehicleName }}</span>
          <span class="lb-card-meta">{{ $t('mark3.battleCount') }} {{ formatHofNumber(row.approvedBattleCount) }} · {{ $t('mark3.winRate') }} {{ formatHofWinRate(row.approvedWinRate) }} · {{ fmtDate(row.approvedAt) || '-' }}</span>
        </div>
        <span class="lb-card-value">{{ formatHofNumber(row.approvedAverageDamage) }}<small>{{ $t('mark3.avgDamage') }}</small></span>
      </li>
    </ol>
    <HofPager v-if="rows.length && !error" data-testid="mark3-pager" :page="page" :total-pages="totalPages" :total-items="totalItems"
              prev-key="mark3.prev" next-key="mark3.next" @go="goPage" />

    <HofMark3SubmitDialog ref="submitDialog" :vehicles="filteredVehicles" :current-list="currentList" :pending-list="pendingList"
                          :after-submit="onSubmitted" />
  </div>
</template>
