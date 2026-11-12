<script setup>
// 名人堂「百场」榜：筛选 / 分页 / 榜单行 / 个人百场状态（pending / current）/ 撤回的唯一 owner。
// URL query 归 HoFPage：本组件只在加载时 emit('query-change')，并通过 expose 的 queryState / applyQuery 收发。
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createReusableTemplate } from '@vueuse/core'
import { confirm } from '../composables/useConfirm.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { apiErrorLabel } from '../utils/display.js'
import { HUNDRED_VEHICLES } from '../utils/hundredVehicles.js'
import * as api from '../api/hall-of-fame.js'
import { findVehicleStatus, fmtDate, pageTotalItems, rankClass, scrollBoardIntoView, tierXPickerOption, uniqueValues, useHofAccess, useHofEpoch, vehicleChips, vehicleValueLabel as valueLabel } from './hofBoardShared.js'
import FilterChips from './FilterChips.vue'
import AppSheet from './AppSheet.vue'
import AppButton from './AppButton.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import HofPager from './HofPager.vue'
import HofHundredSubmitDialog from './HofHundredSubmitDialog.vue'
import VehiclePicker from './VehiclePicker.vue'

defineProps({
  active: { type: Boolean, default: false },
  filterOpen: { type: Boolean, default: false },
  sheetTarget: { type: Object, default: null },
})
const emit = defineEmits(['query-change', 'toggle-filters', 'close-filters'])

const { locale, t, te } = useI18n()
const { isCompact } = useBreakpoint()
const { hofAvailability, isAuthenticated, requireHofOnline } = useHofAccess()
const [DefineFilters, ReuseFilters] = createReusableTemplate()
const pane = ref(null)
const submitDialog = ref(null)

// common/tankopedia-tier10.json 的稳定分类映射由公开页与管理页共用。
const vehicles = HUNDRED_VEHICLES
const vehicleId = ref(null)
const vehicleName = ref('')
const nation = ref('')
const vehicleType = ref('')
const rows = ref([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const totalPages = ref(0)
const totalItems = ref(null)
const PAGE_SIZE = 50
let loadGeneration = 0
const currentEpoch = useHofEpoch(hofAvailability, () => {
  loadGeneration++
  loading.value = false
})

const pendingList = ref([])
const currentList = ref([])
const withdrawingId = ref(null)
const msg = ref('')
const msgErr = ref(false)

const vehicleValueLabel = value => valueLabel(t, te, value)
const nations = uniqueValues(vehicles.map(vehicle => vehicle.nation))
const vehicleTypes = uniqueValues(vehicles.map(vehicle => vehicle.vehicleType))
const filteredVehicles = computed(() => vehicles.filter(vehicle =>
  (!nation.value || vehicle.nation === nation.value)
    && (!vehicleType.value || vehicle.vehicleType === vehicleType.value)))
const pickerOptions = computed(() => filteredVehicles.value.map(vehicle => tierXPickerOption(t, te, vehicle)))
const vehicleLabel = computed(() => (vehicleId.value ? vehicleName.value || `#${vehicleId.value}` : ''))

const currentPending = computed(() => findVehicleStatus(pendingList.value, vehicleId.value))
const currentPendingDamage = computed(() => currentPending.value?.claimedAverageDamage)
const currentPendingBattles = computed(() => currentPending.value?.claimedBattleCount)

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
    const res = await api.hofHundredList(params)
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

// 个人中心百场状态（需登录）：仅登录后拉取，避免匿名浏览触发 401 跳登录。
async function loadPending() {
  if (!hofAvailability.value.available) return
  const epoch = currentEpoch()
  if (!isAuthenticated()) {
    pendingList.value = []
    currentList.value = []
    return
  }
  try {
    const status = await api.hofHundredMyStatus()
    if (epoch !== currentEpoch()) return
    pendingList.value = status.pending || []
    currentList.value = Array.isArray(status.current) ? status.current : []
  } catch {
    if (epoch !== currentEpoch()) return
    pendingList.value = []
    currentList.value = []
  }
}

function loadAll() {
  loadList()
  loadPending()
}

function reloadFirstPage() {
  msg.value = ''
  page.value = 1
  loadAll()
}

function onVehicleChange() {
  vehicleName.value = vehicles.find(x => x.id === Number(vehicleId.value))?.name || ''
  reloadFirstPage()
}

function onVehicleFilterChange() {
  if (vehicleId.value && !filteredVehicles.value.some(vehicle => vehicle.id === Number(vehicleId.value))) {
    vehicleId.value = null
    vehicleName.value = ''
  }
  reloadFirstPage()
}

function goPage(p) {
  page.value = p
  loadList()
  scrollBoardIntoView(pane)
}

async function onSubmitted() {
  msg.value = t('hundred.submitSuccess')
  msgErr.value = false
  await loadList()
  await loadPending()
}

async function withdrawPending(p) {
  if (!requireHofOnline()) return
  if (withdrawingId.value) return
  if (!(await confirm({ title: t('hundred.withdrawConfirm'), confirmLabel: t('hundred.withdraw'), danger: true }))) return
  if (!requireHofOnline()) return
  withdrawingId.value = p.id
  msg.value = ''
  try {
    await api.hofHundredCancel(p.id)
    await loadPending()
    msg.value = t('hundred.withdrawSuccess')
    msgErr.value = false
  } catch (e) {
    msg.value = apiErrorLabel(t, te, e)
    msgErr.value = true
  } finally {
    withdrawingId.value = null
  }
}

const chips = computed(() => vehicleChips(t, te, nation.value, vehicleType.value, vehicleLabel.value))
function removeFilter(key) {
  if (key === 'nation') nation.value = ''
  if (key === 'type') vehicleType.value = ''
  if (key === 'vehicle') { vehicleId.value = null; return onVehicleChange() }
  onVehicleFilterChange()
}

defineExpose({
  queryState: () => ({ tab: 'hundred', page: page.value, tank: vehicleId.value, nation: nation.value, type: vehicleType.value }),
  applyQuery(q) {
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
  <div ref="pane" class="h100-pane" data-hof-pane="hundred">
    <ShowcaseHero v-if="active" section="hof" :kicker="$t('hof.btn')" :title="$t('hundred.tab')" :description="$t('hundred.subtitle')">
      <template v-if="totalItems != null" #stats><div><span class="lb-hero-stat-label">{{ $t('hof.heroTotal') }}</span><strong>{{ totalItems.toLocaleString(locale) }}</strong></div></template>
      <template #actions>
      <div class="lb-submit-row">
        <button type="button" class="filebtn h100-submit-btn" data-tour="hof-submit" :disabled="!!currentPending || loading" @click="submitDialog?.open(vehicleId)">
          <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg>{{ $t('hundred.submit') }}
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
      <label class="lb-limit h100-filter"><span class="lb-label">{{ $t('hundred.nation') }}</span>
        <select v-model="nation" @change="onVehicleFilterChange">
          <option value="">{{ $t('hundred.allNations') }}</option>
          <option v-for="item in nations" :key="item" :value="item">{{ vehicleValueLabel(item) }}</option>
        </select>
      </label>
      <label class="lb-limit h100-filter"><span class="lb-label">{{ $t('hundred.vehicleType') }}</span>
        <select v-model="vehicleType" @change="onVehicleFilterChange">
          <option value="">{{ $t('hundred.allVehicleTypes') }}</option>
          <option v-for="item in vehicleTypes" :key="item" :value="item">{{ vehicleValueLabel(item) }}</option>
        </select>
      </label>
      <div class="lb-limit h100-vehicle-filter"><label class="lb-label" for="hof-hundred-vehicle">{{ $t('hundred.selectVehicle') }}</label>
        <VehiclePicker v-model="vehicleId" class="h100-vehicle-select" input-id="hof-hundred-vehicle"
                       :options="pickerOptions" :null-label="$t('hundred.default')" :fallback-label="vehicleLabel"
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
      {{ $t('hundred.selectVehicle') }}: <strong>{{ vehicleLabel }}</strong>
    </p>

    <div v-if="currentPending" class="h100-pending-card">
      <div class="h100-pending-body">
        <div class="h100-pending-title">{{ $t('hundred.pendingTitle', { vehicle: currentPending.vehicleName || vehicleName }) }}</div>
        <div class="h100-pending-meta">
          <span>{{ $t('hundred.pendingDamage') }}: <strong>{{ currentPendingDamage != null ? currentPendingDamage.toLocaleString() : '—' }}</strong></span>
          <span>{{ $t('hundred.pendingBattles') }}: <strong>{{ currentPendingBattles != null ? currentPendingBattles.toLocaleString() : '—' }}</strong></span>
          <span class="h100-pending-time">{{ $t('hundred.pendingTime') }}: {{ fmtDate(currentPending.submittedAt) || '-' }}</span>
        </div>
      </div>
      <button type="button" class="ghost sm danger" :disabled="withdrawingId === currentPending.id" @click="withdrawPending(currentPending)">
        {{ withdrawingId === currentPending.id ? $t('hundred.withdrawing') : $t('hundred.withdraw') }}
      </button>
    </div>

    <p v-if="msg" class="lb-upload-msg" :class="{ err: msgErr }">{{ msg }}</p>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading && !rows.length" class="muted">{{ $t('hundred.loading') }}</p>
    <div v-else-if="!rows.length" class="lb-empty" data-testid="hundred-empty">
      <p class="lb-empty-title">{{ $t(vehicleId ? 'hundred.empty' : 'hundred.emptyDefault') }}</p>
      <p class="lb-empty-how">{{ $t('hofHowTo.hundred', { action: $t('hundred.submit') }) }}</p>
    </div>
    <div v-else-if="!isCompact" class="tablewrap" data-hof-board data-tour="hof-records" :class="{ 'is-stale': loading }" :aria-busy="loading">
      <table>
        <thead>
          <tr>
            <th>{{ $t('hundred.rank') }}</th>
            <th>{{ $t('hundred.vehicle') }}</th>
            <th>{{ $t('hundred.nickname') }}</th>
            <th>{{ $t('hundred.avgDamage') }}</th>
            <th>{{ $t('hundred.battleCount') }}</th>
            <th>{{ $t('hundred.approvedAt') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td><span class="rk" :class="rankClass(r.rank)">{{ r.rank }}</span></td>
            <td>{{ r.vehicleName }}</td>
            <td>{{ r.nickname }}</td>
            <td class="lb-dmg">{{ r.approvedAverageDamage.toLocaleString() }}</td>
            <td>{{ r.approvedBattleCount }}</td>
            <td class="lb-time">{{ fmtDate(r.approvedAt) || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ol v-else class="lb-cards" data-hof-board data-tour="hof-records" :class="{ 'is-stale': loading }" :aria-busy="loading" data-testid="hundred-cards">
      <li v-for="r in rows" :key="r.id" class="lb-card">
        <span class="rk" :class="rankClass(r.rank)">{{ r.rank }}</span>
        <div class="lb-card-main">
          <strong class="lb-card-name">{{ r.nickname }}</strong>
          <span class="lb-card-tank">{{ r.vehicleName }}</span>
          <span class="lb-card-meta">{{ $t('hundred.battleCount') }} {{ r.approvedBattleCount }} · {{ fmtDate(r.approvedAt) || '-' }}</span>
        </div>
        <span class="lb-card-value">{{ r.approvedAverageDamage.toLocaleString() }}<small>{{ $t('hundred.avgDamage') }}</small></span>
      </li>
    </ol>
    <HofPager v-if="rows.length && !error" data-testid="hundred-pager" :page="page" :total-pages="totalPages" :total-items="totalItems"
              prev-key="hundred.prev" next-key="hundred.next" @go="goPage" />

    <HofHundredSubmitDialog ref="submitDialog" :vehicles="filteredVehicles" :pending-list="pendingList" :current-list="currentList"
                            :after-submit="onSubmitted" />
  </div>
</template>
