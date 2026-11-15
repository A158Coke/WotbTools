<script setup lang="ts">
// 名人堂「单场」榜：筛选 / 分页 / 榜单行 / 回放上传与下载的唯一 owner。
// URL query 归 HoFPage：本组件只在加载时 emit('query-change')，并通过 expose 的 queryState / applyQuery 收发。
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createReusableTemplate } from '@vueuse/core'
import { useHofReplayUpload } from '../composables/useHofReplayUpload.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel, formatDateTimeMinute } from '../utils/display.js'
import { HUNDRED_VEHICLES } from '../utils/hundredVehicles.js'
import { formatGameVersion } from '../utils/gameVersion.js'
import { resolveVehicleName, vehicleNameIndex } from '../utils/hofVehicles.js'
import * as api from '../api/hall-of-fame.js'
import type { components } from '../api/generated/http-contract.js'
import { compactChips, pageTotalItems, rankClass, scrollBoardIntoView, uniqueValues, useHofAccess, useHofEpoch, vehicleChips, vehicleHint, vehicleValueLabel as valueLabel, type HofQuery, type PickerOption } from './hofBoardShared.js'
import FilterChips from './FilterChips.vue'
import AppSheet from './AppSheet.vue'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import HofPodium from './HofPodium.vue'
import HofPager from './HofPager.vue'
import VehiclePicker from './VehiclePicker.vue'

type HofRecord = components['schemas']['HallOfFameRecord']
type VehicleOption = components['schemas']['HofVehicleOption']

defineProps<{ active?: boolean, filterOpen?: boolean, sheetTarget?: HTMLElement | null }>()
const emit = defineEmits<{ 'query-change': [], 'toggle-filters': [], 'close-filters': [] }>()

const { locale, t, te } = useI18n()
const { isCompact } = useBreakpoint()
const { hofAvailability, requireLogin } = useHofAccess()
const [DefineFilters, ReuseFilters] = createReusableTemplate()
const pane = ref<HTMLElement | null>(null)

const rows = ref<HofRecord[]>([])
const loading = ref(false)
const error = ref('')
const limit = ref(50)
const page = ref(1)
const totalPages = ref(0)
const totalItems = ref<number | null>(null)
const showUploadModal = ref(false)
const downloadingId = ref<number | null>(null)
const downloadErr = ref('')

const battleType = ref('')
const selectedTankId = ref<number | null>(null)
const selectedTankName = ref('')
const nickname = ref('')
const vehicleOptions = ref<VehicleOption[]>([])
const vehicleOptionsLoading = ref(false)
const vehicleOptionsError = ref('')
const nation = ref('')
const vehicleType = ref('')
const vehicleTier = ref('')
let loadGeneration = 0
const { uploading, uploadMsg, uploadOk, dragging, onUploadButtonClick, onFileChange, onDrop } = useHofReplayUpload({
  requireLogin,
  fileInput: useTemplateRef<HTMLInputElement>('replayFileInput'),
  afterUpload: () => load(),
})
const currentEpoch = useHofEpoch(hofAvailability, () => {
  loadGeneration++
  loading.value = vehicleOptionsLoading.value = false
})

const vehicleValueLabel = (value: string | null | undefined) => valueLabel(t, te, value)
const nations = computed(() => uniqueValues(vehicleOptions.value.map(vehicle => vehicle.nation)))
const vehicleTypes = computed(() => uniqueValues(vehicleOptions.value.map(vehicle => vehicle.type)))
const vehicleTiers = computed(() => uniqueValues(vehicleOptions.value.map(vehicle => vehicle.tier)).sort((a, b) => a - b))
const filteredVehicles = computed(() => vehicleOptions.value
  .filter(vehicle => (!nation.value || vehicle.nation === nation.value)
    && (!vehicleType.value || vehicle.type === vehicleType.value)
    && (!vehicleTier.value || String(vehicle.tier) === vehicleTier.value)))

// ── 车辆显示名（审计 BZ-17）：后端查不到车名时回退为 `#4657`，前端再用 Tier X 车表与已加载榜单行补全 ──
const tier10NameById = vehicleNameIndex(HUNDRED_VEHICLES)
const rowNameById = computed(() => vehicleNameIndex(rows.value, 'tankId', 'tankName'))
function knownTankName(tankId: number | null, ...candidates: (string | null | undefined)[]): string {
  const id = Number(tankId)
  return resolveVehicleName(...candidates, tier10NameById.get(id), rowNameById.value.get(id))
}
const pickerOptions = computed<PickerOption[]>(() => filteredVehicles.value
  .map(vehicle => ({
    id: vehicle.tankId,
    label: knownTankName(vehicle.tankId, vehicle.tankName) || t('vehiclePicker.unknownId', { id: vehicle.tankId }),
    hint: vehicleHint(vehicle.tier == null ? '' : `T${vehicle.tier}`, vehicleValueLabel(vehicle.nation), vehicleValueLabel(vehicle.type)),
  }))
  .sort((a, b) => a.label.localeCompare(b.label)))
/** 当前单场车辆的显示名：深链 ?tank= 指向的车辆不在选项里时也要显示为已选（能解析出车名就用车名，否则 `#id`）。 */
const selectedTankLabel = computed(() => {
  if (!selectedTankId.value) return ''
  const option = pickerOptions.value.find(item => item.id === Number(selectedTankId.value))
  return option?.label || knownTankName(selectedTankId.value, selectedTankName.value) || `#${selectedTankId.value}`
})
/** 领奖台只用前三行；mapName 的 null 按「无地图」传给 HofPodium。 */
const podiumRows = computed(() => rows.value.slice(0, 3).map(row => ({ ...row, mapName: row.mapName ?? undefined })))

async function load() {
  if (!hofAvailability.value.available) return
  const epoch = currentEpoch()
  emit('query-change')
  const generation = ++loadGeneration
  loading.value = true
  error.value = ''
  try {
    const params = {
      page: page.value,
      size: limit.value,
      battleType: battleType.value,
      tankId: selectedTankId.value,
      nation: nation.value,
      vehicleType: vehicleType.value,
      tier: vehicleTier.value,
      nickname: nickname.value.trim(),
    }
    const res = await api.hofList(params)
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

function reloadFirstPage() {
  page.value = 1
  load()
}

function filterByTank(tankId: number, tankName: string) {
  nation.value = ''
  vehicleType.value = ''
  vehicleTier.value = ''
  selectedTankId.value = tankId
  selectedTankName.value = tankName
  reloadFirstPage()
}

async function loadVehicleOptions() {
  if (!hofAvailability.value.available) return
  const epoch = currentEpoch()
  vehicleOptionsLoading.value = true
  vehicleOptionsError.value = ''
  try {
    const options = await api.hofVehicleOptions()
    if (epoch !== currentEpoch()) return
    vehicleOptions.value = options || []
  } catch (e) {
    if (epoch !== currentEpoch()) return
    vehicleOptionsError.value = apiErrorLabel(t, te, e)
  } finally {
    if (epoch === currentEpoch()) vehicleOptionsLoading.value = false
  }
}

function onVehicleConditionChange() {
  if (selectedTankId.value
      && !filteredVehicles.value.some(vehicle => vehicle.tankId === Number(selectedTankId.value))) {
    selectedTankId.value = null
    selectedTankName.value = ''
  }
  reloadFirstPage()
}

function vehicleNameFromOptions(tankId: number | null, options: readonly VehicleOption[] = vehicleOptions.value) {
  const vehicle = options.find(option => option.tankId === Number(tankId))
  return vehicle ? knownTankName(vehicle.tankId, vehicle.tankName) : ''
}

function onVehicleChange() {
  selectedTankName.value = vehicleNameFromOptions(selectedTankId.value)
  reloadFirstPage()
}

// ── 版本列（审计 BZ-17）：只展示游戏版本号，忽略平台 / 渠道后缀 ──
const fmtVersion = (value: string | null) => formatGameVersion(value) || '-'
const fmtTime = (value: string | null) => formatDateTimeMinute(value, 2014)

function battleTypeLabel(tp: string) {
  if (tp === 'RATING') return t('hof.battleType.rating')
  if (tp === 'RANDOM') return t('hof.battleType.random')
  return ''
}

function clearFilter() {
  selectedTankId.value = null
  selectedTankName.value = ''
  reloadFirstPage()
}

function goPage(p: number) {
  page.value = p
  load()
  scrollBoardIntoView(pane)
}

async function download(id: number) {
  if (downloadingId.value) return
  if (!requireLogin()) return
  downloadErr.value = ''
  downloadingId.value = id
  try {
    await api.hofDownload(id)
  } catch (e) {
    downloadErr.value = apiErrorLabel(t, te, e)
  } finally {
    downloadingId.value = null
  }
}

// 车辆名在选项加载后才能解析（直接打开带 tank 的链接时）
watch(vehicleOptions, (options) => {
  if (selectedTankId.value && !selectedTankName.value) {
    selectedTankName.value = vehicleNameFromOptions(selectedTankId.value, options)
  }
})

// ── 手机筛选（审计 PG-05 / design-language §9）：筛选收进底部 sheet，已生效条件显示为 chip ──
const chips = computed(() => compactChips([
  ...vehicleChips(t, te, nation.value, vehicleType.value, ''),
  vehicleTier.value && { key: 'tier', label: `T${vehicleTier.value}` },
  selectedTankId.value && { key: 'vehicle', label: selectedTankLabel.value },
  battleType.value && { key: 'bt', label: battleTypeLabel(battleType.value) },
  nickname.value.trim() && { key: 'nick', label: nickname.value.trim() },
]))

function removeFilter(key: string) {
  if (key === 'nation') nation.value = ''
  if (key === 'type') vehicleType.value = ''
  if (key === 'tier') vehicleTier.value = ''
  if (key === 'nation' || key === 'type' || key === 'tier') return onVehicleConditionChange()
  if (key === 'vehicle') return clearFilter()
  if (key === 'bt') battleType.value = ''
  if (key === 'nick') nickname.value = ''
  if (key === 'bt' || key === 'nick') reloadFirstPage()
}

defineExpose({
  queryState: () => ({
    tab: 'single', page: page.value, tank: selectedTankId.value, nation: nation.value, type: vehicleType.value,
    tier: vehicleTier.value, bt: battleType.value, nick: nickname.value.trim(), limit: limit.value,
  }),
  applyQuery(q: HofQuery) {
    nation.value = q.nation
    vehicleType.value = q.type
    vehicleTier.value = q.tier
    selectedTankId.value = q.tank
    selectedTankName.value = vehicleNameFromOptions(q.tank)
    battleType.value = q.bt
    nickname.value = q.nick
    limit.value = q.limit ?? limit.value
    page.value = q.page
    load()
  },
  // 直接打开百场 / 三环链接时单场榜还没加载过
  activate() { if (!rows.value.length && !loading.value) load() },
  reload: load,
  loadVehicleOptions,
})
</script>

<template>
  <div ref="pane" data-hof-pane="single">
    <ShowcaseHero v-if="active" section="hof" :kicker="$t('hof.btn')" :title="$t('hof.title')" :description="$t('hof.subtitle')">
      <template v-if="totalItems != null" #stats><div><span class="lb-hero-stat-label">{{ $t('hof.heroTotal') }}</span><strong>{{ totalItems.toLocaleString(locale) }}</strong></div></template>
      <template #actions>
      <div class="lb-submit-row">
        <button type="button" class="filebtn" data-tour="hof-submit" @click="showUploadModal = true">
          <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg>{{ $t('hof.submit_entry') }}
        </button>
        <span v-if="uploadMsg" class="lb-upload-msg" :class="{ err: !uploadOk }">{{ uploadMsg }}</span>
      </div>
      </template>
    </ShowcaseHero>

    <HofPodium v-if="page === 1 && rows.length >= 3 && !error" :rows="podiumRows" :compact="isCompact" :locale="locale" />

    <!-- 提交记录 Modal（§29：上传入口不再长期占据首屏，Ranking 成为核心） -->
    <AppDialog :open="showUploadModal" :title="$t('hof.upload_title')" class="hof-upload-modal" @close="showUploadModal = false">
        <section class="hof-rules" data-testid="hof-rules-single">
          <h3 class="hof-rules-title">{{ $t('hofRules.title') }}</h3>
          <ul>
            <li>{{ $t('hofRules.single.recorder') }}</li>
            <li>{{ $t('hofRules.single.modes') }}</li>
          </ul>
        </section>
        <section class="lb-upload-section"
                 @dragover.prevent="dragging = true"
                 @dragleave.prevent="dragging = false"
                 @drop.prevent="onDrop">
          <div class="lb-upload-card" :class="{ dragging }">
            <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
            <div class="up-title">{{ $t('hof.upload_title') }}</div>
            <div class="up-sub">{{ $t('hof.upload_hint') }}</div>
            <input ref="replayFileInput" type="file" accept=".wotbreplay" class="lb-hidden-input" tabindex="-1" aria-hidden="true" @change="onFileChange" :disabled="uploading" />
            <button type="button" class="filebtn" :class="{ 'lb-uploading': uploading }" @click="onUploadButtonClick">
              <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
              {{ uploading ? $t('hof.uploading') : $t('hof.upload_btn') }}
            </button>
          </div>
          <p v-if="uploadMsg" class="lb-upload-msg" :class="{ err: !uploadOk }">{{ uploadMsg }}</p>
        </section>
    </AppDialog>

    <FilterChips data-tour="hof-filters" v-if="isCompact" :chips="chips" :open="filterOpen" @toggle="emit('toggle-filters')" @remove="removeFilter" />
    <DefineFilters>
    <div class="lb-toolbar-host" :data-tour="isCompact ? 'hof-filter-options' : 'hof-filters'" :class="{ 'is-sheet': isCompact }">
      <div v-if="isCompact" class="lb-sheet-head">
        <strong>{{ $t('filters.title') }}</strong>
        <AppButton variant="primary" data-testid="filter-done" @click="emit('close-filters')">{{ $t('filters.done') }}</AppButton>
      </div>
      <div class="lb-toolbar">
      <label class="lb-limit"><span class="lb-label">{{ $t('hof.nation') }}</span>
        <select v-model="nation" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
          <option value="">{{ $t('hof.allNations') }}</option>
          <option v-for="item in nations" :key="item" :value="item">{{ vehicleValueLabel(item) }}</option>
        </select>
      </label>
      <label class="lb-limit"><span class="lb-label">{{ $t('hof.vehicleType') }}</span>
        <select v-model="vehicleType" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
          <option value="">{{ $t('hof.allVehicleTypes') }}</option>
          <option v-for="type in vehicleTypes" :key="type" :value="type">{{ vehicleValueLabel(type) }}</option>
        </select>
      </label>
      <label class="lb-limit"><span class="lb-label">{{ $t('hof.vehicleTier') }}</span>
        <select v-model="vehicleTier" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
          <option value="">{{ $t('hof.allVehicleTiers') }}</option>
          <option v-for="tier in vehicleTiers" :key="tier" :value="String(tier)">T{{ tier }}</option>
        </select>
      </label>
      <div class="lb-limit"><label class="lb-label" for="hof-single-vehicle">{{ $t('hof.selectVehicle') }}</label>
        <VehiclePicker :model-value="selectedTankId ?? undefined" @update:model-value="selectedTankId = $event" class="hof-vehicle-select" input-id="hof-single-vehicle"
                       :options="pickerOptions" :null-label="$t('hof.all_tanks')" :fallback-label="selectedTankLabel"
                       :disabled="vehicleOptionsLoading" @change="onVehicleChange" />
      </div>
      <label class="lb-limit"><span class="lb-label">{{ $t('hof.battleTypeLabel') }}</span>
        <select v-model="battleType" @change="reloadFirstPage">
          <option value="">{{ $t('hof.battleType.all') }}</option>
          <option value="RANDOM">{{ $t('hof.battleType.random') }}</option>
          <option value="RATING">{{ $t('hof.battleType.rating') }}</option>
        </select>
      </label>
      <label class="lb-limit"><span class="lb-label">{{ $t('hof.nicknameSearch') }}</span>
        <span class="lb-nick-row"><input v-model="nickname" class="lb-nick-input" :placeholder="$t('hof.nicknamePlaceholder')" @keyup.enter="reloadFirstPage" />
        <button type="button" class="ghost sm" @click="reloadFirstPage">{{ $t('hof.search') }}</button></span>
      </label>
      <label class="lb-limit"><span class="lb-label">{{ $t('hof.limit') }}</span>
        <select v-model.number="limit" @change="reloadFirstPage">
          <option :value="20">20</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </label>
      <button v-if="selectedTankId" type="button" class="ghost sm" @click="clearFilter">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM14.8 9.2l-5.6 5.6M9.2 9.2l5.6 5.6" /></svg>{{ $t('hof.all_tanks') }}
      </button>
      <button type="button" class="ghost sm" :disabled="loading" @click="load">
        <svg class="ic" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v6h-6" /></svg>{{ $t('hof.refresh') }}
      </button>
    </div>

    <p v-if="vehicleOptionsError" class="error">{{ vehicleOptionsError }}</p>

    </div>
    </DefineFilters>
    <AppSheet v-if="isCompact" :portal-to="sheetTarget" :open="filterOpen" :title="$t('filters.title')" @close="emit('close-filters')"><ReuseFilters /></AppSheet>
    <ReuseFilters v-else />
    <p v-if="selectedTankId && !isCompact" class="lb-filter-hint">
      {{ $t('hof.filter_tank') }}: <strong>{{ selectedTankLabel }}</strong>
    </p>

    <p v-if="downloadErr" class="lb-upload-msg err">{{ downloadErr }}</p>
    <p v-if="error" class="error">{{ $t('hof.error') }}: {{ error }}</p>
    <p v-else-if="loading && !rows.length" class="muted">{{ $t('hof.loading') }}</p>
    <p v-else-if="!rows.length" class="muted">{{ $t('hof.empty') }}</p>
    <div v-else-if="!isCompact" class="tablewrap" data-hof-board data-tour="hof-records" :class="{ 'is-stale': loading }" :aria-busy="loading">
      <table>
        <thead>
          <tr>
            <th>{{ $t('hof.rank') }}</th>
            <th>{{ $t('hof.nickname') }}</th>
            <th>{{ $t('hof.tank_name') }}</th>
            <th>{{ $t('hof.battleTypeLabel') }}</th>
            <th>{{ $t('hof.damage_dealt') }}</th>
            <th>{{ $t('hof.map') }}</th>
            <th>{{ $t('hof.version') }}</th>
            <th>{{ $t('hof.battle_time') }}</th>
            <th>{{ $t('hof.upload_time') }}</th>
            <th>{{ $t('hof.replay') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td><span class="rk" :class="rankClass(r.rank)">{{ r.rank }}</span></td>
            <td>{{ r.nickname }}</td>
            <td>
              <button
                v-if="!selectedTankId"
                type="button"
                class="lb-tank-link"
                :title="$t('hof.filter_by_tank')"
                @click="filterByTank(r.tankId, r.tankName)"
              >{{ r.tankName }}</button>
              <span v-else>{{ r.tankName }}</span>
            </td>
            <td><span class="bt-badge" :class="r.battleType === 'RATING' ? 'bt-rating' : 'bt-random'">{{ battleTypeLabel(r.battleType) }}</span></td>
            <td class="lb-dmg">{{ r.damageDealt.toLocaleString() }}</td>
            <td>{{ mapLabel(r.mapName, locale) }}</td>
            <td class="lb-version">{{ fmtVersion(r.version) }}</td>
            <td class="lb-time">{{ fmtTime(r.battleTime) || '-' }}</td>
            <td class="lb-time">{{ fmtTime(r.createdAt) }}</td>
            <td class="lb-replay">
              <button
                v-if="r.replayAvailable"
                type="button"
                class="lb-download"
                :disabled="downloadingId === r.id"
                :title="downloadingId === r.id ? $t('hof.downloading') : $t('hof.download')"
                :aria-label="downloadingId === r.id ? $t('hof.downloading') : $t('hof.download')"
                @click="download(r.id)"
              >
                <svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 15l4 4 4-4M12 3v16" /></svg>
              </button>
              <span v-else class="lb-no-replay">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 手机：卡片列表（审计 PG-05：10 列表格在 375 宽下要横向滚动，下载按钮被挤到屏幕外） -->
    <ol v-else class="lb-cards" data-hof-board data-tour="hof-records" :class="{ 'is-stale': loading }" :aria-busy="loading" data-testid="hof-cards">
      <li v-for="r in rows" :key="r.id" class="lb-card">
        <span class="rk" :class="rankClass(r.rank)">{{ r.rank }}</span>
        <div class="lb-card-main">
          <strong class="lb-card-name">{{ r.nickname }}</strong>
          <button v-if="!selectedTankId" type="button" class="lb-card-tank" @click="filterByTank(r.tankId, r.tankName)">{{ r.tankName }}</button>
          <span v-else class="lb-card-tank">{{ r.tankName }}</span>
          <span class="lb-card-meta">
            <span class="bt-badge" :class="r.battleType === 'RATING' ? 'bt-rating' : 'bt-random'">{{ battleTypeLabel(r.battleType) }}</span>
            {{ mapLabel(r.mapName, locale) }} · {{ fmtTime(r.battleTime) || '-' }}
          </span>
        </div>
        <span class="lb-card-value">{{ r.damageDealt.toLocaleString() }}<small>{{ $t('hof.damage_dealt') }}</small></span>
        <button
          v-if="r.replayAvailable"
          type="button"
          class="lb-card-download"
          :disabled="downloadingId === r.id"
          :aria-label="downloadingId === r.id ? $t('hof.downloading') : $t('hof.download')"
          @click="download(r.id)"
        ><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 15l4 4 4-4M12 3v16" /></svg></button>
      </li>
    </ol>
    <HofPager v-if="rows.length && !error" data-testid="hof-pager" :page="page" :total-pages="totalPages" :total-items="totalItems"
              prev-key="hof.prev" next-key="hof.next" @go="goPage" />
  </div>
</template>
