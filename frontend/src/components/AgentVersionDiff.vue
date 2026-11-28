<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import AppSelectMenu from './AppSelectMenu.vue'
import VersionDiffReading from './version-diff/VersionDiffReading.vue'
import VersionDiffVehicle from './version-diff/VersionDiffVehicle.vue'
import TankDiffDialog from './version-diff/TankDiffDialog.vue'
import ArmorDiffDialog from './version-diff/ArmorDiffDialog.vue'
import ArmorChangeList from './version-diff/ArmorChangeList.vue'
import ArmorComparisonViewport from './version-diff/ArmorComparisonViewport.vue'
import MapDiffDialog from './version-diff/MapDiffDialog.vue'
import { datasetTankImageUrl } from '../composables/useVersionDiff.js'
import { useVersionDiffPage } from '../composables/useVersionDiffPage.js'
import type { DiffMapRow, DiffTankRow } from '../composables/useVersionDiffPage.js'
import {
  diffPathLabel, diffStatValues, fmtDiffValue, isPitchChange, pairLabel, parameterRows, statusLabel, tankRows as detailRows,
} from './version-diff/versionDiffFormat.js'
import type { DiffConfigKey } from './version-diff/versionDiffFormat.js'
import { shellLabel } from '../scene/tankMeta.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { defaultShellIndex, gunCycleOf } from '../replay-local/compute/tankSetupHelpers.js'
import { calculateGunDamageRate } from '../replay-local/compute/gunCharacteristics.js'
import './version-diff/version-diff.css'

const { t, te } = useI18n()
const {
  catalog, selectedPairId, summary, summaryState, summaryError, releaseMismatch, armorVerification,
  paramFormat, statDetails, topConfigs, coverCrops, tankProfiles, mapQuery, tankDialog, armorDialog, mapDialog,
  pair, lineup, armorTanks, statTanks, otherTanks, synopsis, allMaps, mapRows,
  techTree, presentation, artifacts, unresolved, gameplayItems, techTreeChanged, itemSchemas, hasData,
  selectPair, tankDataset, loadSummary, armorDetailFor, openTank, openArmor, openMap,
  setArmorSelection, armorSelectionKeys, armorSelectionConfigKey, openVersion, openArmorViewer, openMapVersion,
  retryCatalog, schemaEntries,
} = useVersionDiffPage()

function tankIcon(row: DiffTankRow | null): string {
  const dataset = row?.status === 'removed' ? pair.value?.from?.dataset : pair.value?.to?.dataset
  if (!dataset || row?.id == null) return ''
  return datasetTankImageUrl(dataset, row.id)
}

function mapInstanceSummary(row: DiffMapRow): string[] {
  const counts = {
    instancesAdded: row.counts?.destructibleInstancesAdded,
    instancesRemoved: row.counts?.destructibleInstancesRemoved,
    healthChanged: row.counts?.destructibleHealthChanged,
  }
  const lines = Object.entries(counts).filter(([, n]) => n)
    .map(([key, n]) => t('versionDiff.map.' + key, { n }))
  // 场景物件/草地实例计数（diff 侧逐实例统计，权威来自导出器契约）。
  if (row.counts?.sceneryOld != null) {
    lines.push(t('versionDiff.map.sceneryChange', {
      old: row.counts.sceneryOld, new: row.counts.sceneryNew,
    }) + (row.counts.sceneryAdded || row.counts.sceneryRemoved
      ? `（+${row.counts.sceneryAdded || 0} / −${row.counts.sceneryRemoved || 0}）` : ''))
  }
  if (row.counts?.grassOld != null) {
    lines.push(t('versionDiff.map.grassChange', {
      old: row.counts.grassOld, new: row.counts.grassNew,
    }))
  }
  return lines
}

function mapCategorySummary(row: DiffMapRow): string {
  if (row.status !== 'changed') return statusLabel(row.status ?? 'changed', t, te)
  return (row.categories || []).map(category => {
    const key = 'versionDiff.map.' + category
    return te(key) ? t(key) : category
  }).join(' · ')
}

function fieldName(path: string): string {
  return diffPathLabel(path, t, te, type => shellLabel({ type }))
}

function configName(config?: DiffConfigKey | null): string {
  return [config?.turret, config?.gun].filter(Boolean).join(' · ')
}

interface CompareGroup {
  key: string
  name: string
  changes: Array<{ path: string } & ReturnType<typeof diffStatValues>>
}

function compareGroups(row: DiffTankRow): CompareGroup[] {
  const detail = statDetails.value[row.id]
  const changes = parameterRows(detail ? detailRows(detail, row) : row.chips || [], topConfigs.value[row.id])
  const groups = new Map<string, CompareGroup>()
  const visible = changes.filter(change => {
    if (change.scope === 'research' || (change.category != null && ['geometry', 'armor'].includes(change.category))) return false
    if (change.path?.startsWith('armor.') || change.path?.startsWith('armorModel.')) return false
    return change.old !== 'changed' || change.new !== 'changed'
  })
  const identity = visible.filter(change => change.category === 'identity')
  const pitch = visible.filter(isPitchChange)
  const featured = [...identity, ...pitch, ...visible.filter(change => change.category !== 'identity' && !isPitchChange(change))].slice(0, 4)
  for (const change of featured) {
    const config = change.config
    const key = config ? JSON.stringify([
      config.turretLocal ?? config.turret, config.gunLocal ?? config.gun,
    ]) : ''
    if (!groups.has(key)) groups.set(key, { key, name: configName(config), changes: [] })
    const path = change.displayPath || change.changePath || change.path || ''
    groups.get(key)!.changes.push({ path, ...diffStatValues(path, change.old, change.new, t, paramFormat.value, te) })
  }
  return [...groups.values()]
}

function iconCropStyle(row: DiffTankRow): { transform: string } | null {
  const crop = coverCrops.value[tankDataset(row)]?.[String(row.id)]
  const transform = tankIconCropTransform(crop, 8 / 5)
  return transform ? { transform } : null
}

function vehicleIdentity(row: DiffTankRow) {
  return {
    name: row.name || '',
    nation: row.nation,
    tier: row.tier,
    type: row.type,
    image: tankIcon(row),
    cropStyle: iconCropStyle(row),
    premium: row.premium === true,
    collector: row.collector === true,
  }
}

function profileStats(row: DiffTankRow): Array<{ key: string; value: unknown; unit?: string }> {
  const data = tankProfiles.value[row.id]
  const config = data?.configs?.length === 1 ? data.configs[0] : null
  const shell = config?.shells?.[defaultShellIndex(config)]
  const hull = data?.armor?.hull
  const cycle = gunCycleOf(config)
  const dpm = cycle && typeof shell?.damage === 'number' && Number.isFinite(shell.damage)
    ? calculateGunDamageRate(cycle, cycle.reload, shell.damage, true, 1, cycle.intraClip, 1).dpm
    : config?.dpm
  const stats = [
    { key: 'agentTanks.hp', value: data?.hp, unit: 'HIT_POINTS' },
    { key: 'agentTanks.params.gunCommonDamagePerMin', value: dpm },
    { key: 'agentTanks.pen', value: shell?.penetration, unit: 'MILLIMETER' },
    { key: 'versionDiff.log.hullArmor', value: hull && [hull.front, hull.sides, hull.rear].every(Number.isFinite)
      ? [hull.front, hull.sides, hull.rear].join(' / ') : null, unit: 'MILLIMETER' },
    { key: 'versionDiff.log.speed', value: data?.speed_forward != null && data?.speed_reverse != null
      ? [data.speed_forward, data.speed_reverse].join(' / ') : null, unit: 'KILOMETER_PER_HOUR' },
    { key: 'agentTanks.view_range', value: config?.view_range, unit: 'METER' },
  ]
  return stats.filter(stat => stat.value != null)
}

function itemFileLabel(name: string): string {
  return te(`versionDiff.items.${name}`) ? t(`versionDiff.items.${name}`) : name
}
</script>

<template>
  <main class="vd-page">
    <header class="vd-hero ui-card">
      <div>
        <h1 class="vd-title">{{ pair ? t('versionDiff.log.title', { version: pair.to.dataset }) : t('versionDiff.title') }}</h1>
      </div>
      <div v-if="pair" class="vd-pair-picker">
        <span id="vd-pair-label" class="vd-pair-label">{{ t('versionDiff.pair') }}</span>
        <AppSelectMenu
          class="vd-pair-trigger"
          aria-labelledby="vd-pair-label vd-pair-value"
          :model-value="selectedPairId"
          :options="[...catalog.pairs].reverse().map(item => ({ value: item.id, label: pairLabel(item) }))"
          @update:model-value="id => selectPair(catalog.pairs.find(item => item.id === id) ?? null)"
        >
          <span id="vd-pair-value" class="vd-pair-versions">
            <span>{{ pair.from.dataset }}</span>
            <ArrowRight :size="16" aria-hidden="true" />
            <strong>{{ pair.to.dataset }}</strong>
          </span>
          <ChevronDown :size="16" aria-hidden="true" />
        </AppSelectMenu>
      </div>
    </header>

    <section v-if="catalog.status === 'loading'" class="vd-state ui-card">
      <p class="vd-muted">{{ t('versionDiff.loading') }}</p>
    </section>
    <section v-else-if="catalog.status === 'error'" class="vd-state ui-card">
      <p class="vd-error">{{ t('versionDiff.loadFailed') }}</p>
      <p class="vd-muted">{{ catalog.error }}</p>
      <AppButton variant="secondary" @click="retryCatalog"><RefreshCw :size="16" />{{ t('versionDiff.retry') }}</AppButton>
    </section>
    <section v-else-if="!catalog.pairs.length" class="vd-state ui-card">
      <p class="vd-muted">{{ t('versionDiff.empty') }}</p>
    </section>

    <template v-else-if="pair">
      <p v-if="releaseMismatch.length" class="vd-warning ui-card" role="status">
        {{ t('versionDiff.releaseMismatch') }}
        <span v-for="identity in releaseMismatch" :key="identity.side"> · {{ pair[identity.side].dataset }}</span>
      </p>
      <p v-if="summaryState === 'loading'" class="vd-muted vd-state ui-card" role="status">{{ t('versionDiff.loading') }}</p>
      <div v-else-if="summaryState === 'error'" class="vd-state ui-card">
        <p class="vd-error">{{ summaryError }}</p>
        <AppButton variant="secondary" @click="loadSummary(pair)">{{ t('versionDiff.retry') }}</AppButton>
      </div>

      <p v-else-if="summary && !synopsis.length && !hasData" class="vd-muted vd-state ui-card">{{ t('versionDiff.empty') }}</p>
      <div v-else-if="summary" :key="pair.path" class="vd-changes">
        <p v-if="synopsis.length" class="vd-synopsis ui-card">
          {{ synopsis.map(item => t(item.key) + ' ' + item.count).join(' · ') }}
        </p>

        <section v-for="section in lineup" :id="'vd-section-' + section.id" :key="section.id" class="vd-panel ui-section">
          <h2 class="vd-section-title">{{ t(section.title) }} <small>{{ section.rows.length }}</small></h2>
          <div class="vd-lineup">
            <article v-for="row in section.rows" :key="row.id" class="vd-lineup-card ui-card">
              <button type="button" class="vd-identity-action vd-lineup-action" @click="openVersion(tankDataset(row), row)">
                <VersionDiffVehicle v-bind="vehicleIdentity(row)" compact />
                <ChevronRight :size="16" class="vd-lineup-arrow" aria-hidden="true" />
              </button>
              <dl v-if="tankProfiles[row.id]" class="vd-stats">
                <div v-for="{ key, value, unit } in profileStats(row)" :key="key">
                  <dt>{{ t(key) }}</dt><dd><VersionDiffReading :value="fmtDiffValue(value)" :unit="unit ? t('agentTanks.units.' + unit) : undefined" /></dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <details v-if="allMaps.length" id="vd-section-maps" class="vd-disclosure ui-card">
          <summary>
            <span>{{ t('versionDiff.summary.mapsChanged') }} <small>{{ allMaps.length }}</small></span>
            <ChevronRight :size="16" aria-hidden="true" />
          </summary>
          <div class="vd-map-content">
            <label class="vd-search">
              <Search :size="16" aria-hidden="true" />
              <input v-model="mapQuery" type="search" :aria-label="t('versionDiff.filters.searchMap')" :placeholder="t('versionDiff.filters.searchMap')">
            </label>
            <p v-if="!mapRows.length" class="vd-muted">{{ t('versionDiff.empty') }}</p>
            <ul v-else class="vd-map-list">
              <li v-for="row in mapRows" :key="`${row.status}-${row.mapId}`">
                <button type="button" class="vd-map-row" @click="openMap(row)">
                  <span>
                    <strong>{{ row.display || row.key }}</strong>
                    <span class="vd-muted">
                      {{ mapInstanceSummary(row).join(' · ') || mapCategorySummary(row) }}
                    </span>
                  </span>
                  <ChevronRight :size="16" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </div>
        </details>

        <section v-if="armorTanks.length" id="vd-section-armor" class="vd-panel ui-section">
          <h2 class="vd-section-title">{{ t('versionDiff.summary.armorChanged') }} <small>{{ armorTanks.length }}</small></h2>
          <div class="vd-armor-previews">
            <article v-for="row in armorTanks" :key="row.id" class="vd-armor-preview ui-card">
              <button type="button" class="vd-identity-action vd-armor-action" @click="openVersion(tankDataset(row), row)">
                <VersionDiffVehicle v-bind="vehicleIdentity(row)" compact />
                <ChevronRight :size="16" aria-hidden="true" />
              </button>
              <ArmorComparisonViewport
                :tank-id="row.id"
                :tank-name="row.name"
                :pair="pair"
                :verification="armorVerification"
                :load-detail="() => armorDetailFor(row)"
                :isolate-keys="armorSelectionKeys(row)" :isolate-config-key="armorSelectionConfigKey(row)"
                @select="keys => setArmorSelection(row, keys)"
              />
              <details v-if="statDetails[row.id]" class="vd-armor-changes">
                <summary>{{ t('versionDiff.armor.detail') }}</summary>
                <ArmorChangeList
                  :armor="statDetails[row.id]?.armor"
                  :detail="statDetails[row.id]"
                  :pair="pair"
                  selectable
                  :selected-keys="armorSelectionKeys(row)"
                  :selected-config-key="armorSelectionConfigKey(row)"
                  @select="selection => setArmorSelection(row, selection)"
                />
              </details>
            </article>
          </div>
        </section>

        <section v-if="statTanks.length" id="vd-section-tanks" class="vd-panel ui-section">
          <h2 class="vd-section-title">{{ t('versionDiff.log.stats') }} <small>{{ statTanks.length }}</small></h2>
          <div class="vd-stat-grid">
            <article v-for="row in statTanks" :key="row.id" class="vd-vehicle ui-card">
              <button type="button" class="vd-identity-action" @click="openTank(row)">
                <VersionDiffVehicle v-bind="vehicleIdentity(row)" compact />
                <ChevronRight :size="16" aria-hidden="true" />
              </button>
              <div v-for="group in compareGroups(row)" :key="group.key" class="vd-stat-group">
                <p v-if="group.name" class="vd-config-label">{{ group.name }}</p>
                <dl class="vd-comparison">
                  <div v-for="change in group.changes" :key="change.path">
                    <dt>{{ fieldName(change.path) }}</dt>
                    <dd><VersionDiffReading :before="change.old" :value="change.new" :unit="change.unit" :delta="change.delta" :good="change.good" /></dd>
                  </div>
                </dl>
              </div>
              <p v-if="!compareGroups(row).length" class="vd-muted">{{ t('versionDiff.log.tankDetails') }}</p>
            </article>
          </div>
        </section>

        <details v-if="hasData" class="vd-disclosure ui-card">
          <summary><span>{{ t('versionDiff.log.moreChanges') }}</span><ChevronRight :size="16" aria-hidden="true" /></summary>
          <div class="vd-data-body">
            <section v-if="otherTanks.length" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.log.researchGeometry') }}</h3>
              <div class="vd-secondary-list">
                <button v-for="row in otherTanks" :key="row.id" type="button" class="vd-text-link" @click="openTank(row)">
                  {{ row.name }} <ChevronRight :size="14" aria-hidden="true" />
                </button>
              </div>
            </section>
            <section v-if="gameplayItems.length || techTreeChanged" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.items.title') }}</h3>
              <ul v-if="gameplayItems.length" class="vd-list">
                <li v-for="file in gameplayItems" :key="file.name">
                  {{ itemFileLabel(file.name) }} ·
                  <span v-if="file.added">{{ t('versionDiff.added') }} {{ file.added }} </span>
                  <span v-if="file.removed">{{ t('versionDiff.removed') }} {{ file.removed }} </span>
                  <span v-if="file.changed">{{ t('versionDiff.log.changedFields', { n: file.changed }) }}</span>
                </li>
              </ul>
              <p v-if="techTreeChanged" class="vd-muted">
                {{ t('versionDiff.items.techTree') }}
                +{{ techTree.addedNodes || 0 }} / −{{ techTree.removedNodes || 0 }} / ~{{ techTree.changedNodes || 0 }}
                · {{ t('versionDiff.items.edges') }}
                +{{ techTree.addedEdges || 0 }} / −{{ techTree.removedEdges || 0 }} / ~{{ techTree.changedEdges || 0 }}
              </p>
            </section>

            <div v-if="summary.modelOnly?.length" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.summary.modelOnly') }} · {{ summary.modelOnly.length }}</h3>
              <div class="vd-inline-actions">
                <AppButton v-for="row in summary.modelOnly" :key="row.id" variant="secondary"
                  @click="openTank({ ...row, status: 'modelOnly' })">{{ row.name }}</AppButton>
              </div>
            </div>
            <p v-if="summary.counts?.tanks?.technicalOnly" class="vd-muted">
              {{ t('versionDiff.summary.technicalOnly') }} · {{ summary.counts?.tanks?.technicalOnly }}
            </p>
            <div v-if="schemaEntries('added').length || schemaEntries('removed').length || itemSchemas.length" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.data.schema') }}</h3>
              <div class="vd-chips">
                <span v-for="[key, count] in schemaEntries('added')" :key="`sa-${key}`" class="vd-chip">{{ key }} ×{{ count }}</span>
                <span v-for="[key, count] in schemaEntries('removed')" :key="`sr-${key}`" class="vd-chip is-warn">-{{ key }} ×{{ count }}</span>
              </div>
              <div v-for="file in itemSchemas" :key="file.name" class="vd-chips">
                <strong>{{ itemFileLabel(file.name) }}</strong>
                <span v-for="[key, count] in Object.entries(file.schema?.added || {})" :key="`a-${key}`" class="vd-chip">+ {{ key }} ×{{ count }}</span>
                <span v-for="[key, count] in Object.entries(file.schema?.removed || {})" :key="`r-${key}`" class="vd-chip">− {{ key }} ×{{ count }}</span>
              </div>
            </div>
            <div v-if="Object.values(presentation).some(Boolean)" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.data.presentation') }}</h3>
              <div class="vd-chips">
                <span class="vd-chip">{{ t('versionDiff.data.tankImages') }} {{ presentation.tankImagesChanged || 0 }}</span>
                <span class="vd-chip">{{ t('versionDiff.data.map2d') }} {{ presentation.map2dChanged || 0 }}</span>
                <span class="vd-chip">{{ t('versionDiff.data.cover') }} {{ presentation.coverChanged || 0 }}</span>
                <span class="vd-chip">{{ t('versionDiff.data.ground') }} {{ presentation.groundChanged || 0 }}</span>
              </div>
            </div>
            <div v-if="Object.values(artifacts).some(value => Array.isArray(value) ? value.length : value)" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.data.artifacts') }}</h3>
              <div class="vd-chips">
                <span class="vd-chip">{{ t('versionDiff.data.models') }} {{ artifacts.modelChanged || 0 }}</span>
                <span class="vd-chip">{{ t('versionDiff.data.suspension') }} {{ artifacts.suspensionChanged || 0 }}</span>
                <span class="vd-chip">{{ t('versionDiff.data.tread') }} {{ artifacts.treadChanged || 0 }}</span>
                <span v-for="file in artifacts.dataFilesAdded || []" :key="file" class="vd-chip is-warn">+ {{ file }}</span>
              </div>
            </div>
            <div v-if="summary.meta?.pipelineChanged || unresolved.length" class="vd-block">
              <h3 class="vd-block-title">{{ t('versionDiff.data.notes') }}</h3>
              <p v-if="summary.meta?.pipelineChanged" class="vd-warning">{{ t('versionDiff.data.pipelineChanged') }}</p>
              <p v-if="unresolved.length" class="vd-warning">{{ t('versionDiff.tank.unresolved') }}: {{ unresolved.join(', ') }}</p>
            </div>
          </div>
        </details>
      </div>
    </template>

    <TankDiffDialog
      :open="tankDialog.open"
      :row="tankDialog.row"
      :detail="tankDialog.detail"
      :param-format="paramFormat"
      :top-config="tankDialog.row ? topConfigs[tankDialog.row.id] : undefined"
      :pair="pair"
      :icon-url="tankDialog.row ? tankIcon(tankDialog.row) : ''"
      :crop-style="tankDialog.row ? iconCropStyle(tankDialog.row) : null"
      :loading="tankDialog.loading"
      :error="tankDialog.error"
      @close="tankDialog.open = false"
      @open-armor="openArmor"
      @open-version="openVersion"
    />
    <ArmorDiffDialog
      :open="armorDialog.open"
      :tank-name="armorDialog.tankName"
      :tank-id="armorDialog.tankId"
      :armor="armorDialog.armor"
      :detail="armorDialog.detail"
      :pair="pair"
      @close="armorDialog.open = false"
      @open-armor-viewer="openArmorViewer"
    />
    <MapDiffDialog
      :open="mapDialog.open"
      :row="mapDialog.row"
      :detail="mapDialog.detail"
      :pair="pair"
      :status="mapDialog.status"
      :loading="mapDialog.loading"
      :error="mapDialog.error"
      @retry="mapDialog.row && openMap(mapDialog.row)"
      @close="mapDialog.open = false"
      @open-map="openMapVersion"
    />
  </main>
</template>
