<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '../AppDialog.vue'
import AppButton from '../AppButton.vue'
import {
  armorFaceLabel, armorRows, deltaDiffValue, diffPathLabel, diffStatValues, fmtDiffValue,
  diffConfigIdentity, parameterRows, statusLabel, tankRows,
} from './versionDiffFormat.js'
import type { DiffChange } from './versionDiffFormat.js'
import { shellLabel } from '../../scene/tankMeta.js'
import VersionDiffReading from './VersionDiffReading.vue'
import VersionDiffVehicle from './VersionDiffVehicle.vue'
import type { DiffPair } from '../../composables/useVersionDiff.js'
import type { DiffTankDetail, DiffTankRow } from '../../composables/useVersionDiffPage.js'
import './version-diff.css'

interface TankDiffDialogProps {
  open?: boolean
  row?: DiffTankRow | null
  detail?: DiffTankDetail | null
  topConfig?: string
  paramFormat?: Record<string, unknown> | null
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
const chosenConfig = ref<number | null>(null)

const configs = computed(() => props.detail?.configs?.configs || [])
watch(() => props.detail, (detail) => {
  const hasSummary = (detail?.changes || []).length > 0
  tab.value = hasSummary ? 'summary'
    : detail?.research?.changed ? 'research'
      : detail?.armor?.model?.changed ? 'armor' : 'summary'
  chosenConfig.value = null
}, { immediate: true })

const configIndex = computed({
  get: () => {
    if (chosenConfig.value !== null) return chosenConfig.value
    const top = props.topConfig ? configs.value.findIndex(config => diffConfigIdentity(config.key) === props.topConfig) : -1
    return top >= 0 ? top : Math.max(0, configs.value.length - 1)
  },
  set: (index: number) => { chosenConfig.value = index },
})
const selectedConfig = computed(() => configs.value[configIndex.value] || null)
const allRows = computed(() => tankRows(props.detail, props.row ?? undefined))
const armor = computed(() => props.detail?.armor || null)
const armorSummaryRows = computed(() => armorRows(armor.value).filter(row => row.kind === 'direction'))
const identity = computed(() => (props.row || props.detail?.identity || {}) as { name?: string; nation?: string; tier?: number; type?: string })
const status = computed(() => props.row?.status || 'changed')
const isAddedOrRemoved = computed(() => status.value === 'added' || status.value === 'removed')

const configOptions = computed(() => configs.value.map((config, index) => ({
  index,
  label: config.key?.gun || config.key?.turret || `#${index + 1}`,
})))

const tabRows = computed(() => {
  if (tab.value === 'summary') return allRows.value.filter(row => row.scope === 'summary')
  if (tab.value === 'research' || tab.value === 'armor') return []
  return parameterRows(allRows.value, props.topConfig).filter(row =>
    row.category === tab.value && (row.scope !== 'config' || row.config === selectedConfig.value?.key))
})

const researchChanges = computed(() => allRows.value.filter(row => row.scope === 'research'))
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
  return diffStatValues(row.displayPath || row.changePath || row.path || '', row.old, row.new, t, props.paramFormat, te)
}

const formattedTabRows = computed(() => tabRows.value.map(row => ({ row, diff: rowValues(row) })))
const formattedResearch = computed(() => researchChanges.value.map(row => ({ row, diff: rowValues(row) })))

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

        <div v-if="configOptions.length > 1 && ['firepower', 'mobility'].includes(tab)" class="vd-config-row">
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
          <dl v-if="armorSummaryRows.length" class="vd-param-list">
            <div v-for="row in armorSummaryRows" :key="row.path">
              <dt>{{ armorFaceLabel((row.path || '').slice(6), t, te) }}</dt>
              <dd><VersionDiffReading :before="fmtDiffValue(row.old)" :value="fmtDiffValue(row.new)"
                :unit="t('agentTanks.units.MILLIMETER')" :delta="deltaDiffValue(row.old, row.new)" /></dd>
            </div>
          </dl>
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
          <dl v-if="formattedResearch.length" class="vd-param-list">
            <div v-for="({ row, diff }, index) in formattedResearch" :key="index">
              <dt>{{ rowLabel(row) }}</dt>
              <dd><VersionDiffReading :before="diff.old" :value="diff.new" :unit="diff.unit" :delta="diff.delta" :good="diff.good" /></dd>
            </div>
          </dl>
          <ul v-if="researchAdded.length || researchRemoved.length" class="vd-list">
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
          <dl v-else class="vd-param-list">
            <div v-for="({ row, diff }, index) in formattedTabRows" :key="index">
              <dt>
                {{ rowLabel(row) }}
                <span v-if="row.configLabel" class="vd-muted vd-param-context">{{ row.configLabel }}</span>
              </dt>
              <dd><VersionDiffReading :before="diff.old" :value="diff.new" :unit="diff.unit" :delta="diff.delta" :good="diff.good" /></dd>
            </div>
          </dl>
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