<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '../AppDialog.vue'
import AppButton from '../AppButton.vue'
import {
  armorFaceLabel, armorRows, deltaDiffValue, diffPathLabel, fmtDiffValue,
  statusLabel, tankRows,
} from './versionDiffFormat.js'
import type { DiffChange } from './versionDiffFormat.js'
import { shellLabel } from '../../scene/tankMeta.js'
import VersionDiffVehicle from './VersionDiffVehicle.vue'
import type { DiffPair } from '../../composables/useVersionDiff.js'
import type { DiffTankDetail, DiffTankRow } from '../../composables/useVersionDiffPage.js'
import './version-diff.css'

interface TankDiffDialogProps {
  open?: boolean
  row?: DiffTankRow | null
  detail?: DiffTankDetail | null
  pair?: DiffPair | null
  iconUrl?: string
  cropStyle?: { transform: string } | null
  loading?: boolean
  error?: string
}

const props = withDefaults(defineProps<TankDiffDialogProps>(), {
  open: false,
  row: null,
  pair: null,
  iconUrl: '',
  loading: false,
  error: '',
})
const emit = defineEmits<{ close: []; 'open-armor': []; 'open-version': [dataset: string] }>()
const { t, te } = useI18n()

const tabs = ['summary', 'firepower', 'mobility', 'survivability', 'armor', 'research']
const tab = ref('summary')
const configIndex = ref(0)

const configs = computed(() => props.detail?.configs?.configs || [])
watch(() => props.detail, (detail) => {
  const hasSummary = (detail?.changes || []).length > 0
  tab.value = hasSummary ? 'summary'
    : detail?.research?.changed ? 'research'
      : detail?.armor?.model?.changed ? 'armor' : 'summary'
  configIndex.value = Math.max(0, (detail?.configs?.configs?.length || 1) - 1)
}, { immediate: true })

const selectedConfig = computed(() => configs.value[configIndex.value] || null)
const allRows = computed(() => tankRows(props.detail))
const armor = computed(() => props.detail?.armor || null)
const armorSummaryRows = computed(() => armorRows(armor.value).filter(row => row.kind === 'direction'))
const identity = computed(() => (props.row || props.detail?.identity || {}) as { name?: string; nation?: string; tier?: number; type?: string })
const status = computed(() => props.row?.status || 'changed')
const isAddedOrRemoved = computed(() => status.value === 'added' || status.value === 'removed')

const configOptions = computed(() => configs.value.map((config, index) => ({
  index,
  label: config.key?.gun || config.key?.turret || `#${index + 1}`,
})))

function configRows(config: { key?: { gun?: string; turret?: string; [key: string]: unknown }; changes?: DiffChange[] } | null): DiffChange[] {
  if (!config) return []
  const configLabel = config.key?.gun || config.key?.turret || ''
  return (config.changes || []).map(change => ({
    ...change,
    scope: 'config',
    configLabel,
    displayPath: change.path,
  }))
}

const tabRows = computed(() => {
  if (!props.detail) return []
  const rows = allRows.value.filter(row => row.scope === 'summary')
  const selected = configRows(selectedConfig.value)
  if (tab.value === 'summary') {
    return rows
  }
  if (tab.value === 'research') {
    return props.detail.research?.changes || []
  }
  if (tab.value === 'armor') return []
  return [...rows.filter(row => row.category === tab.value), ...selected.filter(row => row.category === tab.value)]
})

const researchChanges = computed(() => props.detail?.research?.changes || [])
const researchAdded = computed(() => props.detail?.research?.modulesAdded || [])
const researchRemoved = computed(() => props.detail?.research?.modulesRemoved || [])
const researchUnpaired = computed(() => props.detail?.research?.unpaired || [])
const configsAdded = computed(() => props.detail?.configs?.added || [])
const configsRemoved = computed(() => props.detail?.configs?.removed || [])
const unresolved = computed(() => props.detail?.unresolved || [])

function configLabel(config?: { gun?: string; turret?: string; gunLocal?: number } | null): string {
  return config?.gun || config?.turret || (config?.gunLocal != null ? `#${config.gunLocal}` : '')
}

function tabLabel(key: string): string {
  return t(`versionDiff.tabs.${key}`)
}

function rowLabel(row: DiffChange): string {
  return diffPathLabel(row.displayPath || row.path || '', t, te, type => shellLabel({ type }))
}

function rowValues(row: DiffChange) {
  return { old: fmtDiffValue(row.old), new: fmtDiffValue(row.new), delta: deltaDiffValue(row.old, row.new) }
}

function openVersion(dataset: string) {
  emit('open-version', dataset)
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="t('versionDiff.tank.title')"
    size="lg"
    @close="emit('close')"
  >
    <div class="vd-tank">
      <header class="vd-tank-head">
        <VersionDiffVehicle
          :name="identity.name || ''" :nation="identity.nation" :tier="identity.tier" :type="identity.type"
          :image="iconUrl" :crop-style="cropStyle" compact
          :premium="row?.premium === true" :collector="row?.collector === true"
        />
        <span v-if="isAddedOrRemoved || status === 'modelOnly'" class="vd-badge" :class="'is-' + status">{{ statusLabel(status, t, te) }}</span>
      </header>

      <p v-if="loading" class="vd-muted">{{ t('versionDiff.loading') }}</p>
      <p v-else-if="error" class="vd-error">{{ error }}</p>
      <template v-else-if="detail">
        <nav class="vd-tabs" :aria-label="t('versionDiff.tank.title')">
          <button
            v-for="key in tabs"
            :key="key"
            type="button"
            class="vd-tab"
            :class="{ 'is-active': tab === key }"
            @click="tab = key"
          >
            {{ tabLabel(key) }}
          </button>
        </nav>

        <div v-if="configOptions.length > 1 && ['firepower', 'mobility', 'armor'].includes(tab)" class="vd-config-row">
          <label class="vd-config-label" for="vd-config">{{ t('versionDiff.tank.config') }}</label>
          <select id="vd-config" v-model.number="configIndex" class="vd-select">
            <option v-for="option in configOptions" :key="option.index" :value="option.index">{{ option.label }}</option>
          </select>
        </div>

        <div v-if="tab === 'firepower' && (configsAdded.length || configsRemoved.length)" class="vd-block">
          <h3 class="vd-block-title">{{ t('versionDiff.tank.configs') }}</h3>
          <ul class="vd-list">
            <li v-for="item in configsAdded" :key="`ca-${item.turretLocal}-${item.gunLocal}`">
              {{ t('versionDiff.added') }}: {{ configLabel(item) }}
            </li>
            <li v-for="item in configsRemoved" :key="`cr-${item.turretLocal}-${item.gunLocal}`">
              {{ t('versionDiff.removed') }}: {{ configLabel(item) }}
            </li>
          </ul>
        </div>

        <div v-if="tab === 'armor'" class="vd-block">
          <div v-if="armorSummaryRows.length" class="vd-armor-grid">
            <div v-for="row in armorSummaryRows" :key="row.path" class="vd-armor-cell">
              <span class="vd-armor-name">{{ armorFaceLabel((row.path || '').slice(6), t, te) }}</span>
              <span class="vd-value">{{ fmtDiffValue(row.old) }}</span>
              <span class="vd-arrow">→</span>
              <span class="vd-value is-new">{{ fmtDiffValue(row.new) }}</span>
              <span class="vd-delta">{{ deltaDiffValue(row.old, row.new) }}</span>
            </div>
          </div>
          <p v-else class="vd-muted">{{ t('versionDiff.armor.noDirections') }}</p>
          <div v-if="armor" class="vd-inline-actions">
            <AppButton variant="secondary" @click="emit('open-armor')">
              {{ t('versionDiff.tank.openArmor') }}
            </AppButton>
            <span class="vd-muted">{{ t('versionDiff.tank.openArmorHint') }}</span>
          </div>
        </div>

        <div v-else-if="tab === 'research'" class="vd-block">
          <p v-if="!researchChanges.length && !researchAdded.length && !researchRemoved.length" class="vd-muted">
            {{ t('versionDiff.tank.noResearchChanges') }}
          </p>
          <ul v-else class="vd-list">
            <li v-for="(change, index) in researchChanges" :key="`rc-${index}`">
              <strong>{{ rowLabel({ displayPath: `research.${change.path}` }) }}</strong>:
              {{ fmtDiffValue(change.old) }} → {{ fmtDiffValue(change.new) }}
            </li>
            <li v-for="item in researchAdded" :key="`ra-${item}`">
              {{ t('versionDiff.tank.moduleAdded') }}: {{ item }}
            </li>
            <li v-for="item in researchRemoved" :key="`rr-${item}`">
              {{ t('versionDiff.tank.moduleRemoved') }}: {{ item }}
            </li>
          </ul>
          <p v-if="researchUnpaired.length" class="vd-warning">
            {{ t('versionDiff.tank.unpaired') }}: {{ researchUnpaired.join(', ') }}
          </p>
        </div>

        <div v-else class="vd-block">
          <p v-if="!tabRows.length" class="vd-muted">{{ t('versionDiff.tank.noChanges') }}</p>
          <div v-else class="vd-table-wrap">
            <table class="vd-table">
              <thead>
                <tr>
                  <th>{{ t('versionDiff.tank.parameter') }}</th>
                  <th class="is-num">{{ t('versionDiff.old') }}</th>
                  <th class="is-num">{{ t('versionDiff.new') }}</th>
                  <th class="is-num">{{ t('versionDiff.delta') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in tabRows" :key="`${row.displayPath}-${index}`">
                  <td>
                    {{ rowLabel(row) }}
                    <span v-if="row.configLabel" class="vd-muted"> · {{ row.configLabel }}</span>
                  </td>
                  <td class="is-num">{{ rowValues(row).old }}</td>
                  <td class="is-num is-new">{{ rowValues(row).new }}</td>
                  <td class="is-num vd-delta">{{ rowValues(row).delta }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p v-if="unresolved.length" class="vd-warning">
          {{ t('versionDiff.tank.unresolved') }}: {{ unresolved.join(', ') }}
        </p>
      </template>
      <template v-else>
        <p class="vd-muted">
          {{ status === 'modelOnly'
            ? t('versionDiff.tank.modelOnlyHint')
            : (isAddedOrRemoved
              ? (status === 'added' ? t('versionDiff.tank.addedHint') : t('versionDiff.tank.removedHint'))
              : t('versionDiff.tank.noDetail')) }}
        </p>
      </template>
    </div>

    <template #actions>
      <AppButton variant="secondary" @click="emit('close')">{{ t('app.close') }}</AppButton>
      <AppButton v-if="pair && status !== 'added'" variant="secondary" @click="openVersion(pair.from.dataset)">
        {{ t('versionDiff.tank.openOld') }}
      </AppButton>
      <AppButton v-if="pair && status !== 'removed'" variant="primary" @click="openVersion(pair.to.dataset)">
        {{ t('versionDiff.tank.openNew') }}
      </AppButton>
    </template>
  </AppDialog>
</template>