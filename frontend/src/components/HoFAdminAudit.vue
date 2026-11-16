<script setup lang="ts">
// 名人堂管理 · 操作日志分区（只读）。首次激活且没有数据时加载；切回时保留已加载的页。
import { onActivated, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { components } from '../api/generated/http-contract.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { apiErrorLabel, formatDateTimeMinute as fmtTime } from '../utils/display.js'
import { hofAdminAudit } from '../api/hall-of-fame.js'
import { battleTypeLabel } from './HoFAdminSelection.js'

const props = defineProps<{ size: number }>()

const { t, te } = useI18n()
const { requireFeature } = useFeatureGate()

const rows = ref<components['schemas']['HofAdminAudit'][]>([])
const loading = ref(false)
const error = ref('')
const page = ref(1)
const totalPages = ref(0)
const totalItems = ref(0)
let gen = 0

async function load() {
  if (!requireFeature(Feature.HALL_OF_FAME)) return
  const g = ++gen
  loading.value = true
  error.value = ''
  try {
    const res = await hofAdminAudit({ page: page.value, size: props.size })
    if (g !== gen) return
    rows.value = res.items || []
    totalPages.value = res.totalPages || 0
    totalItems.value = res.totalItems || 0
  } catch (e) {
    if (g === gen) error.value = apiErrorLabel(t, te, e)
  } finally {
    if (g === gen) loading.value = false
  }
}

function goPage(p: number) {
  page.value = p
  load()
}

onActivated(() => { if (!rows.value.length) load() })
defineExpose({ reload: load })
</script>

<template>
  <div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="muted">{{ $t('hofAdmin.loading') }}</p>
    <p v-else-if="!rows.length" class="muted">{{ $t('hofAdmin.auditEmpty') }}</p>
    <div v-else class="tablewrap">
      <table class="hof-admin-table">
        <thead>
          <tr>
            <th>{{ $t('hofAdmin.auditTime') }}</th>
            <th>{{ $t('hofAdmin.auditAction') }}</th>
            <th>{{ $t('hofAdmin.auditAdmin') }}</th>
            <th>Record ID</th>
            <th>Account ID</th>
            <th>{{ $t('hofAdmin.player') }}</th>
            <th>{{ $t('hofAdmin.tank') }}</th>
            <th>{{ $t('hofAdmin.damage') }}</th>
            <th>{{ $t('hofAdmin.battleType') }}</th>
            <th>{{ $t('hofAdmin.replayHash') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id">
            <td class="muted">{{ fmtTime(a.createdAt) }}</td>
            <td><span class="audit-action">{{ a.action }}</span></td>
            <td class="muted">{{ a.adminUsername || a.adminKeycloakUserId }}</td>
            <td class="muted">{{ a.recordId }}</td>
            <td class="muted">{{ a.accountId }}</td>
            <td>{{ a.nickname }}</td>
            <td>{{ a.tankName }}</td>
            <td class="dmg">{{ a.damageDealt.toLocaleString() }}</td>
            <td>{{ battleTypeLabel(t, a.battleType) }}</td>
            <td class="muted hash">{{ a.replayHash ? a.replayHash.slice(0, 12) + '…' : '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="totalPages > 1" class="pagination">
      <button :disabled="page <= 1" @click="goPage(page - 1)">{{ $t('hofAdmin.prev') }}</button>
      <span>{{ $t('hofAdmin.pageInfo', { page, total: totalPages, items: totalItems }) }}</span>
      <button :disabled="page >= totalPages" @click="goPage(page + 1)">{{ $t('hofAdmin.next') }}</button>
    </div>
  </div>
</template>

<style scoped src="./HoFAdminShared.css"></style>
