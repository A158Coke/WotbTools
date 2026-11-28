<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '../AppDialog.vue'
import AppButton from '../AppButton.vue'
import VersionCompareDivider from './VersionCompareDivider.vue'
import VersionDiffReading from './VersionDiffReading.vue'
import { datasetMap2dUrl } from '../../composables/useVersionDiff.js'
import type { DiffPair } from '../../composables/useVersionDiff.js'
import type { DiffMapRow } from '../../composables/useVersionDiffPage.js'
import { fmtDiffValue } from './versionDiffFormat.js'
import './version-diff.css'

interface MapDiffDetail {
  preview?: { fromKey?: string; toKey?: string }
  categories?: string[]
  files?: Record<string, boolean>
  presentation?: Record<string, boolean>
  destructibles?: {
    healthChanges?: Array<{ id?: string | number; field?: string; old?: unknown; new?: unknown; position?: unknown; [key: string]: unknown }>
    [key: string]: unknown
  }
  scenery?: { old?: number; new?: number; added?: Record<string, number>; removed?: Record<string, number> }
  grass?: { old?: number; new?: number }
  [key: string]: unknown
}

interface MapDiffDialogProps {
  open?: boolean
  row?: DiffMapRow | null
  detail?: MapDiffDetail | null
  pair?: DiffPair | null
  status?: string
  loading?: boolean
  error?: string
}

const props = withDefaults(defineProps<MapDiffDialogProps>(), {
  open: false,
  row: null,
  pair: null,
  status: 'changed',
  loading: false,
  error: '',
})
const emit = defineEmits<{ close: []; retry: []; 'open-map': [dataset: string] }>()
const { t } = useI18n()
const split = ref(50)
const fromLabel = computed(() => props.pair?.from.dataset || t('versionDiff.old'))
const toLabel = computed(() => props.pair?.to.dataset || t('versionDiff.new'))
const oldFailed = ref(false)
const newFailed = ref(false)

const fromKey = computed(() => props.detail?.preview?.fromKey || props.row?.key || '')
const toKey = computed(() => props.detail?.preview?.toKey || props.row?.key || '')
const showOld = computed(() => props.status !== 'added' && Boolean(props.pair?.from?.dataset && fromKey.value))
const showNew = computed(() => props.status !== 'removed' && Boolean(props.pair?.to?.dataset && toKey.value))
const oldUrl = computed(() => (showOld.value && props.pair?.from?.dataset
  ? datasetMap2dUrl(props.pair.from.dataset, fromKey.value) : ''))
const newUrl = computed(() => (showNew.value && props.pair?.to?.dataset
  ? datasetMap2dUrl(props.pair.to.dataset, toKey.value) : ''))
watch([oldUrl, newUrl], () => {
  oldFailed.value = false
  newFailed.value = false
  split.value = 50
})

const familyLabels: Record<string, string> = {
  terrain: 'versionDiff.map.terrain',
  groundLayers: 'versionDiff.map.groundLayers',
  scenery: 'versionDiff.map.scenery',
  grass: 'versionDiff.map.grass',
  lighting: 'versionDiff.map.lighting',
  destructibles: 'versionDiff.map.destructibles',
  variantContent: 'versionDiff.map.variantContent',
}
const changedFamilies = computed(() => (props.detail?.categories || [])
  .filter(key => familyLabels[key])
  .map(key => ({ key, label: t(familyLabels[key]) })))
const unchangedFamilies = computed(() => {
  const files = props.detail?.files || {}
  const labels = []
  for (const key of ['terrain', 'groundLayers', 'grass']) {
    if (files[key] === false) labels.push(t(familyLabels[key]))
  }
  return labels
})
const presentation = computed(() => {
  const value = props.detail?.presentation || {}
  const labels = []
  if (value.ground) labels.push(t('versionDiff.map.ground'))
  if (value.map2d) labels.push(t('versionDiff.map.map2d'))
  if (value.cover) labels.push(t('versionDiff.map.cover'))
  if (value.mini) labels.push(t('versionDiff.map.mini'))
  return labels
})
const destructibles = computed(() => props.detail?.destructibles || null)
const healthChanges = computed(() => destructibles.value?.healthChanges || [])
const instanceFields = ['instancesAdded', 'instancesRemoved', 'healthChanged', 'collisionTypeChanged', 'prototypeChanged', 'renamed', 'moved']
const instanceCounts = computed(() => instanceFields
  .filter(key => destructibles.value?.[key])
  .map(key => ({ key, count: destructibles.value?.[key] ?? 0 })))
const instanceComparisonAvailable = computed(() => instanceFields
  .every(key => typeof destructibles.value?.[key] === 'number'))
// 场景物件逐名增删（GLB 节点名 = 来源 sc2 物件名），按数量倒序、上限 16 条。
const scenery = computed(() => props.detail?.scenery || null)
const grass = computed(() => props.detail?.grass || null)
const sceneryAddedNames = computed(() => Object.entries(scenery.value?.added || {})
  .map(([name, count]) => ({ name, count, added: true }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  .slice(0, 16))
const sceneryRemovedNames = computed(() => Object.entries(scenery.value?.removed || {})
  .map(([name, count]) => ({ name, count, added: false }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  .slice(0, 16))
const sceneryAddedTotal = computed(() => Object.values(scenery.value?.added || {}).reduce((sum, n) => sum + Number(n), 0))
const sceneryRemovedTotal = computed(() => Object.values(scenery.value?.removed || {}).reduce((sum, n) => sum + Number(n), 0))
const sceneryDelta = computed(() => sceneryAddedTotal.value + sceneryRemovedTotal.value)

function openMap(dataset: string) {
  emit('open-map', dataset)
}

function positionText(item: { position?: unknown }): string {
  return (Array.isArray(item.position) ? item.position : []).map(v => fmtDiffValue(v)).join(', ')
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="`${row?.display || row?.key || ''} · ${t('versionDiff.map.title')}`"
    size="xl"
    @close="emit('close')"
  >
    <div class="vd-map">
      <p v-if="loading" class="vd-muted">{{ t('versionDiff.loading') }}</p>
      <p v-else-if="error" class="vd-error">{{ error }}</p>
      <template v-else>
        <div class="vd-map-overview">
          <div v-if="showOld || showNew" class="vd-map-compare vd-compare-frame">
            <div v-if="showNew" class="vd-map-layer">
              <img
                v-if="newUrl && !newFailed"
                class="vd-map-image"
                :src="newUrl"
                :alt="`${row?.display || ''} ${t('versionDiff.new')}`"
                @error="newFailed = true"
              >
              <div v-else class="vd-map-missing">{{ t('versionDiff.map.imageUnavailable') }}</div>
            </div>
            <div v-if="showOld" class="vd-map-layer" :class="{ 'is-overlay': showNew }"
              :style="showNew ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : null">
              <img
                v-if="oldUrl && !oldFailed"
                class="vd-map-image"
                :src="oldUrl"
                :alt="`${row?.display || ''} ${t('versionDiff.old')}`"
                @error="oldFailed = true"
              >
              <div v-else class="vd-map-missing">{{ t('versionDiff.map.imageUnavailable') }}</div>
            </div>
            <VersionCompareDivider
              v-if="showOld && showNew"
              v-model="split"
              :from="fromLabel"
              :to="toLabel"
              :label="t('versionDiff.map.compare')"
            />
            <span v-else class="vd-map-tag">{{ showOld ? fromLabel : toLabel }}</span>
          </div>

          <div class="vd-map-summary">
            <div class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.map.changes') }}</h3>
              <p v-if="status === 'added'" class="vd-muted">{{ t('versionDiff.map.addedHint') }}</p>
              <p v-else-if="status === 'removed'" class="vd-muted">{{ t('versionDiff.map.removedHint') }}</p>
              <p v-else-if="!changedFamilies.length" class="vd-muted">{{ t('versionDiff.map.noChanges') }}</p>
              <div v-else class="vd-chips">
                <span v-for="item in changedFamilies" :key="item.key" class="vd-chip is-warn">{{ item.label }}</span>
              </div>
              <p v-if="unchangedFamilies.length" class="vd-muted">
                {{ t('versionDiff.map.unchanged') }}: {{ unchangedFamilies.join(' · ') }}
              </p>
              <p v-if="presentation.length" class="vd-muted">
                {{ t('versionDiff.map.presentation') }}: {{ presentation.join(' · ') }}
              </p>
            </div>

            <div v-if="scenery?.old != null || grass?.old != null" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.map.instanceTitle') }}</h3>
              <div class="vd-chips">
                <span v-if="scenery?.old != null" class="vd-chip">
                  {{ t('versionDiff.map.sceneryChange', { old: scenery.old, new: scenery.new }) }}
                  <b v-if="sceneryDelta">{{ t('versionDiff.map.sceneryDelta', { added: sceneryAddedTotal, removed: sceneryRemovedTotal }) }}</b>
                </span>
                <span v-if="grass?.old != null" class="vd-chip">
                  {{ t('versionDiff.map.grassChange', { old: grass.old, new: grass.new }) }}
                </span>
              </div>
              <div v-if="sceneryAddedNames.length || sceneryRemovedNames.length" class="vd-chips">
                <span v-for="item in sceneryAddedNames" :key="`sa-${item.name}`" class="vd-chip">
                  {{ item.name }} <b>+{{ item.count }}</b>
                </span>
                <span v-for="item in sceneryRemovedNames" :key="`sr-${item.name}`" class="vd-chip is-warn">
                  {{ item.name }} <b>−{{ item.count }}</b>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="destructibles" class="vd-block">
          <h3 class="vd-block-title">{{ t('versionDiff.map.destructibles') }}</h3>
          <div v-if="instanceCounts.length" class="vd-chips">
            <span v-for="{ key, count } in instanceCounts" :key="key" class="vd-chip">{{ t('versionDiff.map.' + key, { n: count }) }}</span>
          </div>
          <p v-else-if="instanceComparisonAvailable" class="vd-muted">{{ t('versionDiff.map.instancesUnchanged') }}</p>
          <div v-if="healthChanges.length" class="vd-table-wrap">
            <table class="vd-table">
              <thead>
                <tr>
                  <th>{{ t('versionDiff.map.position') }}</th>
                  <th>{{ t('versionDiff.map.field') }}</th>
                  <th class="is-num">{{ fromLabel }} → {{ toLabel }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in healthChanges" :key="`${item.id}-${item.field}`">
                  <td>{{ positionText(item) }}</td>
                  <td>{{ item.field }}</td>
                  <td class="is-num"><VersionDiffReading :before="fmtDiffValue(item.old)" :value="fmtDiffValue(item.new)" :unit="t('agentTanks.units.HIT_POINTS')" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>

    <template #actions>
      <AppButton variant="secondary" @click="emit('close')">{{ t('app.close') }}</AppButton>
      <AppButton v-if="error" variant="primary" @click="emit('retry')">{{ t('versionDiff.retry') }}</AppButton>
      <AppButton v-if="showOld && detail" variant="secondary" @click="openMap(pair?.from?.dataset ?? '')">
        {{ t('versionDiff.map.openOld') }}
      </AppButton>
      <AppButton v-if="showNew && detail" variant="primary" @click="openMap(pair?.to?.dataset ?? '')">
        {{ t('versionDiff.map.openNew') }}
      </AppButton>
    </template>
  </AppDialog>
</template>