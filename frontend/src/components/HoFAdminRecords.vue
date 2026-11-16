<script setup lang="ts">
// 名人堂管理 · 单场记录分区：列表、筛选、车辆选项、下载、单条删除确认与批量删除选择集都归本组件。
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { components } from '../api/generated/http-contract.js'
import { Check, Download, Trash2 } from 'lucide-vue-next'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { mapLabel } from '../utils/helpers.js'
import { apiErrorLabel, formatDateTimeMinute as fmtTime, replayValueLabel } from '../utils/display.js'
import * as api from '../api/hall-of-fame.js'
import AppDialog from './AppDialog.vue'
import HoFAdminBulkDeleteDialog from './HoFAdminBulkDeleteDialog.vue'
import { battleTypeLabel, createSelection, eventChecked, uniqueValues } from './HoFAdminSelection.js'

type HofAdminRecord = components['schemas']['HofAdminRecord']
type VehicleOption = components['schemas']['HofVehicleOption']

const props = defineProps<{
  /** 认证就绪且有管理员角色：首次为真时加载列表与车辆选项。 */
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
const fNickname = ref('')
const fAccountId = ref('')
const fUploadedBy = ref('')
const fBattleType = ref('')
const fTankId = ref('')
const fReplayAvailable = ref('')
const fSort = ref('')
const vehicleOptions = ref<VehicleOption[]>([])
const vehicleOptionsLoading = ref(false)
const fNation = ref('')
const fTankType = ref('')
const fTankTier = ref('')
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

const selection = createSelection(rows)
const bulkOpen = ref(false)

// 删除确认：Hard delete 必须二次确认；单击删除不立即执行。
const deleteTarget = ref<HofAdminRecord | null>(null)
const deleting = ref(false)
const deleteMsg = ref('')

async function loadRecords() {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const g = ++gen
  loading.value = true
  error.value = ''
  try {
    const params = {
      page: page.value,
      size: props.size,
      nickname: fNickname.value.trim(),
      accountId: fAccountId.value.trim(),
      uploadedBy: fUploadedBy.value.trim(),
      battleType: fBattleType.value,
      tankId: fTankId.value.trim(),
      nation: fNation.value,
      vehicleType: fTankType.value,
      tier: fTankTier.value,
      replayAvailable: fReplayAvailable.value === '' ? '' : fReplayAvailable.value === 'true',
      sort: fSort.value,
    }
    const res = await api.hofAdminList(params)
    if (g !== gen) return
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
  if (fTankId.value) {
    const selectedTankId = Number(fTankId.value)
    if (!filteredVehicles.value.some(vehicle => vehicle.tankId === selectedTankId)) {
      fTankId.value = ''
    }
  }
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

async function onSizeChange(event: Event) {
  emit('update:size', Number((event.target as HTMLSelectElement).value))
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
    <div class="hof-admin-filters">
      <input v-model="fNickname" :placeholder="$t('hofAdmin.fNickname')" @keyup.enter="search" />
      <input v-model="fAccountId" :placeholder="$t('hofAdmin.fAccountId')" @keyup.enter="search" />
      <input v-model="fUploadedBy" :placeholder="$t('hofAdmin.fUploadedBy')" @keyup.enter="search" />
      <select v-model="fNation" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
        <option value="">{{ $t('hofAdmin.allNations') }}</option>
        <option v-for="nation in vehicleNations" :key="nation" :value="nation">{{ replayValueLabel(t, te, nation) }}</option>
      </select>
      <select v-model="fTankType" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
        <option value="">{{ $t('hofAdmin.allVehicleTypes') }}</option>
        <option v-for="type in vehicleTypes" :key="type" :value="type">{{ replayValueLabel(t, te, type) }}</option>
      </select>
      <select v-model="fTankTier" :disabled="vehicleOptionsLoading" @change="onVehicleConditionChange">
        <option value="">{{ $t('hofAdmin.allVehicleTiers') }}</option>
        <option v-for="tier in vehicleTiers" :key="tier" :value="String(tier)">T{{ tier }}</option>
      </select>
      <select v-model="fTankId" :disabled="vehicleOptionsLoading" @change="search">
        <option value="">{{ $t('hofAdmin.allVehicles') }}</option>
        <option v-for="vehicle in filteredVehicles" :key="vehicle.tankId" :value="String(vehicle.tankId)">{{ vehicleLabel(vehicle) }}</option>
      </select>
      <select v-model="fBattleType" @change="search">
        <option value="">{{ $t('hofAdmin.battleTypeAll') }}</option>
        <option value="RANDOM">{{ $t('hof.battleType.random') }}</option>
        <option value="RATING">{{ $t('hof.battleType.rating') }}</option>
      </select>
      <select v-model="fReplayAvailable" @change="search">
        <option value="">{{ $t('hofAdmin.replayAll') }}</option>
        <option value="true">{{ $t('hofAdmin.replayAvailable') }}</option>
        <option value="false">{{ $t('hofAdmin.replayMissing') }}</option>
      </select>
      <select v-model="fSort" @change="search">
        <option value="">{{ $t('hofAdmin.sortDamage') }}</option>
        <option value="battle_time">{{ $t('hofAdmin.sortBattleTime') }}</option>
        <option value="upload_time">{{ $t('hofAdmin.sortUploadTime') }}</option>
      </select>
      <button class="btn-sm" @click="search">{{ $t('hofAdmin.search') }}</button>
    </div>

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
    <label class="page-size">{{ $t('hofAdmin.size') }}
      <select :value="size" @change="onSizeChange">
        <option :value="20">20</option>
        <option :value="50">50</option>
        <option :value="100">100</option>
      </select>
    </label>

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
