<script setup lang="ts">
import { computed, nextTick, ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { components } from '../api/generated/http-contract.js'
import { Check, Download, Trash2 } from 'lucide-vue-next'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel, formatDateTimeMinute as fmtTime, replayValueLabel } from '../utils/display.js'
import * as api from '../api/hall-of-fame.js'
import AppDialog from './AppDialog.vue'
import AdminFilterBar from './AdminFilterBar.vue'
import { compactChips } from './hofBoardShared.js'
import VehiclePicker from './VehiclePicker.vue'
import SegmentedControl from './SegmentedControl.vue'
import HoFAdminBulkDeleteDialog from './HoFAdminBulkDeleteDialog.vue'
import { battleTypeLabel, createFilterState, createSelection, PAGE_SIZES, eventChecked, uniqueValues } from './HoFAdminSelection.js'

type HofAdminRecord = components['schemas']['HofAdminRecord']
type VehicleOption = components['schemas']['HofVehicleOption']

const props = defineProps<{
  ready: boolean
  size: number
}>()
const emit = defineEmits<{ 'update:size': [size: number] }>()

const { t, te, locale } = useI18n()
const { requireFeature } = useFeatureGate()

const rows = ref<HofAdminRecord[]>([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const totalPages = ref(0)
const totalItems = ref(0)
const vehicleOptions = ref<VehicleOption[]>([])
const vehicleOptionsLoading = ref(false)
const { draft, applied, without } = createFilterState({
  nickname: '', accountId: '', uploadedBy: '', battleType: '', tankId: null as number | null,
  replayAvailable: '', sort: '', nation: '', vehicleType: '', tier: '',
})
const { nickname: fNickname, accountId: fAccountId, uploadedBy: fUploadedBy, battleType: fBattleType,
  tankId: fTankId, replayAvailable: fReplayAvailable, sort: fSort, nation: fNation, vehicleType: fTankType, tier: fTankTier } = toRefs(draft)
let gen = 0

const vehicleNations = computed(() => uniqueValues(vehicleOptions.value.map(v => v.nation)))
const vehicleTypes = computed(() => uniqueValues(vehicleOptions.value.map(v => v.type)))
const vehicleTiers = computed(() => uniqueValues(vehicleOptions.value
  .map(v => v.tier)
  .filter(v => v != null))
  .sort((a, b) => a - b))
const filteredVehicles = computed(() => vehicleOptions.value
  .filter(v => (!fNation.value || v.nation === fNation.value)
    && (!fTankType.value || v.type === fTankType.value)
    && (!fTankTier.value || String(v.tier) === fTankTier.value))
  .sort((a, b) => (a.tankName || '').localeCompare(b.tankName || '')))

const pickerOptions = computed(() => filteredVehicles.value.map(vehicle => ({ id: vehicle.tankId, label: vehicleLabel(vehicle) })))

const selection = createSelection(rows)
const bulkOpen = ref(false)

const deleteTarget = ref<HofAdminRecord | null>(null)
const deleting = ref(false)
const deleteMsg = ref('')

const filterChips = computed(() => {
  const f = applied.value
  const vehicle = vehicleOptions.value.find(option => option.tankId === f.tankId)
  return compactChips([
    f.nickname.trim() && { key: 'nickname', label: f.nickname.trim() },
    f.accountId.trim() && { key: 'accountId', label: f.accountId.trim() },
    f.uploadedBy.trim() && { key: 'uploadedBy', label: f.uploadedBy.trim() },
    f.battleType && { key: 'battleType', label: battleTypeLabel(t, f.battleType) },
    f.tankId != null && { key: 'tankId', label: vehicle ? vehicleLabel(vehicle) : String(f.tankId) },
    f.nation && { key: 'nation', label: replayValueLabel(t, te, f.nation) },
    f.vehicleType && { key: 'vehicleType', label: replayValueLabel(t, te, f.vehicleType) },
    f.tier && { key: 'tier', label: 'T' + f.tier },
    f.replayAvailable && { key: 'replayAvailable', label: t(f.replayAvailable === 'true' ? 'hofAdmin.replayAvailable' : 'hofAdmin.replayMissing') },
    f.sort && { key: 'sort', label: t(f.sort === 'battle_time' ? 'hofAdmin.sortBattleTime' : 'hofAdmin.sortUploadTime') },
  ])
})

function removeChip(key: string) {
  if (loading.value) return
  const next = without(key)
  if (!next) return
  page.value = 1
  void loadRecords(next)
}

async function loadRecords(filters = { ...draft }) {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const g = ++gen
  loading.value = true
  error.value = ''
  try {
    const params = {
      ...filters, page: page.value, size: props.size, nickname: filters.nickname.trim(),
      accountId: filters.accountId.trim(), uploadedBy: filters.uploadedBy.trim(),
      tankId: filters.tankId == null ? '' : String(filters.tankId),
      replayAvailable: filters.replayAvailable === '' ? '' : filters.replayAvailable === 'true',
    }
    const res = await api.hofAdminList(params)
    if (g !== gen) return
    applied.value = filters
    rows.value = res.items || []
    totalPages.value = res.totalPages || 0
    totalItems.value = res.totalItems || 0
    selection.prune()
  } catch (e) {
    if (g === gen) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === gen) loading.value = false
  }
}

async function loadVehicleOptions() {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  vehicleOptionsLoading.value = true
  try {
    vehicleOptions.value = (await api.hofAdminVehicleOptions()) || []
  } catch (e) {
    error.value = apiErrorLabel(t, te, e)
  } finally {
    vehicleOptionsLoading.value = false
  }
}

watch(() => props.ready, (ready) => {
  if (!ready) return
  loadRecords()
  loadVehicleOptions()
}, { immediate: true })

function onVehicleConditionChange() {
  if (fTankId.value != null && !filteredVehicles.value.some(vehicle => vehicle.tankId === fTankId.value)) fTankId.value = null
  search()
}

function vehicleLabel(vehicle: VehicleOption) {
  const name = vehicle.tankName || t('hofAdmin.unknownVehicle')
  return vehicle.tier == null ? name : `${name} · T${vehicle.tier}`
}

function search() {
  page.value = 1
  loadRecords()
}

async function onSizeChange(value: string) {
  emit('update:size', Number(value))
  await nextTick()
  search()
}

function goPage(p: number) {
  page.value = p
  loadRecords()
}

async function download(id: number) {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  try {
    await api.hofAdminDownload(id)
  } catch (e) {
    error.value = apiErrorLabel(t, te, e)
  }
}

function askDelete(row: HofAdminRecord) {
  deleteTarget.value = row
  deleteMsg.value = ''
}

function cancelDelete() {
  deleteTarget.value = null
  deleteMsg.value = ''
}

async function confirmDelete() {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  deleteMsg.value = ''
  try {
    await api.hofAdminDelete(deleteTarget.value.id)
    cancelDelete()
    await loadRecords()
  } catch (e) {
    deleteMsg.value = apiErrorLabel(t, te, e)
  } finally {
    deleting.value = false
  }
}

function onBulkSettled(failedIds: number[]) {
  selection.keepOnly(failedIds)
  loadRecords()
}

defineExpose({ reload: loadRecords })
</script>

<template>
  <div>
    <AdminFilterBar :chips="filterChips" :remove-disabled="loading" @remove="removeChip">
      <template #default="{ compact }">
        <div class="hof-admin-filters">
          <input v-model="fNickname" :aria-label="$t('hofAdmin.fNickname')" :placeholder="$t('hofAdmin.fNickname')" @keyup.enter="search" />
          <input v-model="fAccountId" :aria-label="$t('hofAdmin.fAccountId')" :placeholder="$t('hofAdmin.fAccountId')" @keyup.enter="search" />
          <input v-model="fUploadedBy" :aria-label="$t('hofAdmin.fUploadedBy')" :placeholder="$t('hofAdmin.fUploadedBy')" @keyup.enter="search" />
          <select v-model="fNation" :aria-label="$t('hofAdmin.allNations')" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
            <option value="">{{ $t('hofAdmin.allNations') }}</option>
            <option v-for="nation in vehicleNations" :key="nation" :value="nation">{{ replayValueLabel(t, te, nation) }}</option>
          </select>
          <select v-model="fTankType" :aria-label="$t('hofAdmin.allVehicleTypes')" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
            <option value="">{{ $t('hofAdmin.allVehicleTypes') }}</option>
            <option v-for="type in vehicleTypes" :key="type" :value="type">{{ replayValueLabel(t, te, type) }}</option>
          </select>
          <select v-model="fTankTier" :aria-label="$t('hofAdmin.allVehicleTiers')" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
            <option value="">{{ $t('hofAdmin.allVehicleTiers') }}</option>
            <option v-for="tier in vehicleTiers" :key="tier" :value="String(tier)">T{{ tier }}</option>
          </select>
          <VehiclePicker
            :inline="compact"
            :model-value="fTankId ?? undefined" :options="pickerOptions" :input-label="$t('hofAdmin.tank')"
            :null-label="$t('hofAdmin.allVehicles')" :disabled="vehicleOptionsLoading"
            @update:model-value="fTankId = $event" @change="search"
          />
          <select v-model="fBattleType" :aria-label="$t('hofAdmin.battleTypeAll')" @change="search">
            <option value="">{{ $t('hofAdmin.battleTypeAll') }}</option>
            <option value="RANDOM">{{ $t('hof.battleType.random') }}</option>
            <option value="RATING">{{ $t('hof.battleType.rating') }}</option>
          </select>
          <select v-model="fReplayAvailable" :aria-label="$t('hofAdmin.replayAll')" @change="search">
            <option value="">{{ $t('hofAdmin.replayAll') }}</option>
            <option value="true">{{ $t('hofAdmin.replayAvailable') }}</option>
            <option value="false">{{ $t('hofAdmin.replayMissing') }}</option>
          </select>
          <select v-model="fSort" :aria-label="$t('hofAdmin.sortDamage')" @change="search">
            <option value="">{{ $t('hofAdmin.sortDamage') }}</option>
            <option value="battle_time">{{ $t('hofAdmin.sortBattleTime') }}</option>
            <option value="upload_time">{{ $t('hofAdmin.sortUploadTime') }}</option>
          </select>
          <button class="btn-sm" @click="search">{{ $t('hofAdmin.search') }}</button>
        </div>
      </template>
    </AdminFilterBar>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="selection.count()" class="hof-bulk-bar">
      <span class="hof-bulk-count">{{ $t('hofAdmin.selectedCount', { count: selection.count() }) }}</span>
      <button class="btn-sm danger" @click="bulkOpen = true">{{ $t('hofAdmin.bulkDelete') }}</button>
      <button class="btn-sm" @click="selection.clear()">{{ $t('hofAdmin.clearSelection') }}</button>
    </div>
    <p v-if="loading" class="muted">{{ $t('hofAdmin.loading') }}</p>
    <p v-else-if="!rows.length" class="muted">{{ $t('hofAdmin.empty') }}</p>
    <div v-else class="tablewrap">
      <table class="hof-admin-table">
        <thead>
          <tr>
            <th class="hof-check">
              <input
                type="checkbox"
                :checked="selection.allSelected()"
                :aria-label="$t('hofAdmin.selectAllPage')"
                @change="selection.toggleAll(eventChecked($event))"
              />
            </th>
            <th>ID</th>
            <th>{{ $t('hofAdmin.player') }}</th>
            <th>{{ $t('hofAdmin.accountId') }}</th>
            <th>{{ $t('hofAdmin.tank') }}</th>
            <th>{{ $t('hofAdmin.battleType') }}</th>
            <th>{{ $t('hofAdmin.damage') }}</th>
            <th>{{ $t('hofAdmin.map') }}</th>
            <th>{{ $t('hofAdmin.version') }}</th>
            <th>{{ $t('hofAdmin.battleTime') }}</th>
            <th>{{ $t('hofAdmin.uploadTime') }}</th>
            <th>{{ $t('hofAdmin.replayHash') }}</th>
            <th>{{ $t('hofAdmin.replaySize') }}</th>
            <th>{{ $t('hofAdmin.uploadedBy') }}</th>
            <th>{{ $t('hofAdmin.replay') }}</th>
            <th class="actions">{{ $t('hofAdmin.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="hof-check">
              <input
                type="checkbox"
                :checked="selection.isSelected(r)"
                :aria-label="$t('hofAdmin.selectRow', { id: r.id })"
                @change="selection.toggle(r, eventChecked($event))"
              />
            </td>
            <td class="muted">{{ r.id }}</td>
            <td>{{ r.nickname }}</td>
            <td class="muted">{{ r.accountId }}</td>
            <td>{{ r.tankName }}</td>
            <td><span class="bt-badge" :class="r.battleType === 'RATING' ? 'bt-rating' : 'bt-random'">{{ battleTypeLabel(t, r.battleType) }}</span></td>
            <td class="dmg">{{ r.damageDealt.toLocaleString() }}</td>
            <td>{{ mapLabel(r.mapName, locale) }}</td>
            <td class="muted">{{ r.version || '-' }}</td>
            <td class="muted">{{ fmtTime(r.battleTime) || '-' }}</td>
            <td class="muted">{{ fmtTime(r.createdAt) }}</td>
            <td class="muted hash">{{ r.replayHash ? r.replayHash.slice(0, 12) + '…' : '-' }}</td>
            <td class="muted">{{ r.replaySize != null ? r.replaySize.toLocaleString() : '-' }}</td>
            <td class="muted">{{ r.replayUploadedBy || '-' }}</td>
            <td>
              <Check v-if="r.replayAvailable" class="hof-icon val-ok" :size="16" :aria-label="$t('hofAdmin.replayAvailable')" role="img" />
              <span v-else>—</span>
            </td>
            <td class="actions">
              <button v-if="r.replayAvailable" type="button" class="btn-sm btn-icon" :title="$t('hofAdmin.download')" :aria-label="$t('hofAdmin.download')" @click="download(r.id)">
                <Download :size="16" aria-hidden="true" />
              </button>
              <button type="button" class="btn-sm btn-icon danger" :title="$t('hofAdmin.delete')" :aria-label="$t('hofAdmin.delete')" @click="askDelete(r)">
                <Trash2 :size="16" aria-hidden="true" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="totalPages > 1" class="pagination">
      <button :disabled="page <= 1" @click="goPage(page - 1)">{{ $t('hofAdmin.prev') }}</button>
      <span>{{ $t('hofAdmin.pageInfo', { page, total: totalPages, items: totalItems }) }}</span>
      <button :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t('hofAdmin.next') }}</button>
    </div>
    <div class="page-size"><span>{{ $t('hofAdmin.size') }}</span>
      <SegmentedControl :model-value="String(size)" :ariaLabel="$t('hofAdmin.size')" :options="PAGE_SIZES" @update:model-value="onSizeChange" />
    </div>

    <HoFAdminBulkDeleteDialog v-model:open="bulkOpen" domain="records" :ids="selection.selected.value" @settled="onBulkSettled" />

    <AppDialog
      :open="!!deleteTarget"
      :title="$t('hofAdmin.deleteTitle')"
      size="sm"
      tone="danger"
      class="hof-delete-modal"
      @close="!deleting && cancelDelete()"
    >
      <p class="hof-delete-msg">{{ $t('hofAdmin.deleteHint') }}</p>
      <table v-if="deleteTarget" class="hof-delete-table">
        <tbody>
          <tr><th>{{ $t('hofAdmin.player') }}</th><td>{{ deleteTarget.nickname }}</td></tr>
          <tr><th>{{ $t('hofAdmin.tank') }}</th><td>{{ deleteTarget.tankName }}</td></tr>
          <tr><th>{{ $t('hofAdmin.damage') }}</th><td>{{ deleteTarget.damageDealt.toLocaleString() }}</td></tr>
          <tr><th>{{ $t('hofAdmin.battleType') }}</th><td>{{ battleTypeLabel(t, deleteTarget.battleType) }}</td></tr>
          <tr><th>{{ $t('hofAdmin.map') }}</th><td>{{ mapLabel(deleteTarget.mapName, locale) }}</td></tr>
          <tr><th>{{ $t('hofAdmin.battleTime') }}</th><td>{{ fmtTime(deleteTarget.battleTime) || '-' }}</td></tr>
        </tbody>
      </table>
      <p v-if="deleteMsg" class="error">{{ deleteMsg }}</p>
      <div class="modal-actions">
        <button class="btn-sm" :disabled="deleting" @click="cancelDelete">{{ $t('hofAdmin.cancel') }}</button>
        <button class="btn-sm danger" :disabled="deleting" @click="confirmDelete">
          {{ deleting ? $t('hofAdmin.deleting') : $t('hofAdmin.delete') }}
        </button>
      </div>
    </AppDialog>
  </div>
</template>

<style scoped src="./HoFAdminShared.css"></style>
