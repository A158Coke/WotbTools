<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { locationForView } from '../app/navigation'
import { useI18n } from 'vue-i18n'
import { useTankopediaDetailData } from './tankopedia/useTankopediaDetailData.ts'
import { useTankopediaSetupModel } from './tankopedia/useTankopediaSetupModel.ts'
import { ArrowLeft, Box, GitBranch, Network, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { fetchTankEncyclopedia, tankImageUrl, loadTankIconCrops } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { romanLevel } from '../utils/tierFormat.js'
import { TYPE_CLS, normType, shellLabel, isPremiumShell, fmt, fmtNum, tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import {
  normalizeTankCache, parseTankopediaQuery, sameTankopediaQuery, withTankopediaState,
} from '../utils/tankopediaQuery.js'
import { shellIconUrl } from '../utils/researchCatalog.js'
import {
  buildComputeInput, decodeDevices, devicesFromEquipmentIds, encodeDevices,
  defaultShellIndex, findTankModules, paramGroups, pickGun, pickTurret, pitchDeviceBonus, resolveSetup,
} from '../replay-local/compute/tankSetup'
import ShowcaseHero from './ShowcaseHero.vue'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import TankCoverNation from './TankCoverNation.vue'
import TankConfigPanel from './TankConfigPanel.vue'
import TankResearchPanel from './TankResearchPanel.vue'
import TankAugmentTree from './TankAugmentTree.vue'
import MobilityChart from './MobilityChart.vue'
import MobilityActivations from './MobilityActivations.vue'
import { mobilityVehicle, saveComparison, snapshot, useMobilityDataset, describeSetup } from '../composables/tankMobility'
import TankParamPanel from './TankParamPanel.vue'
import TankMechanicsChips from './tankopedia/TankMechanicsChips.vue'
import AppDialog from './AppDialog.vue'
import { Motion } from 'motion-v'
import { motionTransition } from '../shared/motion/motionPolicy'

const VIEW = 'agent-tankopedia'

const { t, te, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const pendingQuery = ref(null)
const effectiveQuery = computed(() => pendingQuery.value || route.query)
const urlState = computed(() => parseTankopediaQuery(effectiveQuery.value))
const onView = () => route.query?.view === VIEW
watch(() => route.query, () => { pendingQuery.value = null }, { flush: 'sync' })

function writeState(patch, { push = false } = {}) {
  if (!onView()) return
  const base = effectiveQuery.value
  const query = withTankopediaState(base, { ...urlState.value, ...patch })
  if (sameTankopediaQuery(base, query)) return
  pendingQuery.value = query
  router[push ? 'push' : 'replace']({ query })
}

const listFilters = computed(() => ({
  q: urlState.value.q,
  tier: urlState.value.tier,
  nation: urlState.value.nation,
  type: urlState.value.type,
  category: urlState.value.category,
  sort: urlState.value.sort,
}))
function writeFilters(filters) {
  writeState({
    q: filters.q,
    tier: filters.tier,
    nation: filters.nation,
    type: filters.type,
    category: filters.category,
    sort: filters.sort,
  })
}

const nationLabel = nation => tankNationLabel(t, te, nation)
const typeLabel = type => tankTypeLabel(t, te, type)
const tierLabel = tier => romanLevel(tier)

const cache = ref({})
const listState = ref('loading')
const listError = ref('')

const tanks = computed(() => normalizeTankCache(cache.value))

async function loadList() {
  listState.value = 'loading'
  listError.value = ''
  try {
    cache.value = await fetchTankEncyclopedia()
    listState.value = 'ready'
  } catch (e) {
    console.error('tankopedia load failed:', e)
    listError.value = String(e?.message || e)
    listState.value = 'error'
  }
}

function openDetail(id) {
  writeState({ tank: id, config: null, upgrade: null, abilities: [] }, { push: true })
}
function backToList() {
  writeState({ tank: null, config: null })
}

const detailId = computed(() => urlState.value.tank)
const detailData = useTankopediaDetailData({ urlState, detailId, writeState })
const {
  detail, detailState, detailError, modules, catalog, techTree,
  summary, bindCache, upgradeSelection, upgradeProjection,
  cfgs, cfgIdx, curCfg, shells, pitchLimits, gunDepression, gunElevation,
  loadDetail, setup,
} = detailData
bindCache(() => cache.value)
const setupModel = useTankopediaSetupModel({ detailId, writeState, data: detailData, cache, route, VIEW, locale, t, te })
const {
  researchOpen, isXiResearch, augmentInstalled, augmentChosen, augmentWritable,
  onAugmentResearch, onAugmentResearchAll, onAugmentResearchNone,
  researchPrevVehicles, researchNextVehicles, installFromGraph, openVehicleFromGraph,
  computeInput, characteristics, previousCharacteristics, paramTable, deviceIds,
  mechanicRows, shellRows, moduleName, currentTurret, currentGun, currentEngine, currentTrack,
  gunMeta, yawLimits, pitchBonus,
  applyModulePreset, writeSetup, selectShell, cycleSkill, maxSkills, clearSkills, resetSetup,
  configForArmor,
} = setupModel

const listMounted = ref(detailId.value == null)
watch(detailId, id => { if (id == null) listMounted.value = true })

const dataset = useMobilityDataset()
const activations = ref({})
watch(detailId, () => { activations.value = {} }, { flush: 'sync' })
watch(() => setup.value.consumables, stems => {
  for (const stem of Object.keys(activations.value)) if (!stems.includes(stem)) delete activations.value[stem]
})
const vehicle = computed(() => mobilityVehicle({
  id: String(detailId.value), name: detail.value?.name, catalog: catalog.value,
  input: dataset.value ? computeInput.value : null, activations: activations.value,
  color: 'var(--color-accent)', summary: describeSetup(modules.value, setup.value, catalog.value, locale.value, t),
}))
function openMobility(withVehicle) {
  const target = locationForView('agent-mobility', route)
  target.query.mobilityReturn = router.resolve({ path: route.path, query: effectiveQuery.value, hash: route.hash }).fullPath
  delete target.query.comparison
  delete target.query.mobilitySeed
  if (withVehicle) {
    const entry = snapshot(detailId.value, modules.value, setup.value, dataset.value, activations.value)
    const key = crypto.randomUUID()
    const comparison = { v: 2, entries: [entry], crew: { skills: { ...setup.value.skills }, conditionalSkills: setup.value.conditionalSkills === true } }
    saveComparison(key, comparison)
    target.query.comparison = key
    target.query.mobilitySeed = JSON.stringify(comparison)
  }
  router.push(target)
}

function openTechTree() {
  const dest = locationForView('agent-techtree', route)
  router.push({ path: dest.path, query: { ...dest.query, view: 'agent-techtree' } })
}

function open3d() {
  const dest = locationForView('agent-armor', route)
  const handoff = setup.value.canConfigure
    ? {
        ...(upgradeSelection.value.available ? {
          upgrade: setup.value.upgrade ?? 'top',
          ...(setup.value.abilities?.length ? { abilities: setup.value.abilities.join(',') } : {}),
        } : {}),
        dev: encodeDevices(setup.value.devices),
        cons: setup.value.consumables.join(','),
        prov: setup.value.provisions.join(','),
        ...(deviceIds.value.has(103) ? { eqcal: '1' } : {}),
        ...(deviceIds.value.has(110) ? { eqenh: '1' } : {}),
        ...(deviceIds.value.has(122) ? { eqpitch: '1' } : {}),
      }
    : {}
  router.push({
    path: dest.path,
    query: {
      ...dest.query,
      view: 'agent-armor',
      tank: String(detailId.value),
      config: String(configForArmor.value),
      ...handoff,
    },
  })
}

function hideBrokenImage(event) {
  event.target.hidden = true
}

const ICON_BOX_ASPECT = 8 / 5
const iconCrops = ref(null)
loadTankIconCrops().then((crops) => { iconCrops.value = crops })
function iconCropStyle(id) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(id)], ICON_BOX_ASPECT)
  return transform ? { transform } : null
}

onMounted(() => {
  loadList()
  if (detailId.value != null) loadDetail(detailId.value)
})
</script>

<template>
  <section class="tankopedia" data-testid="tankopedia">
    <template v-if="detailId != null">
      <div class="tp-detail-nav">
        <AppButton variant="ghost" size="sm" data-testid="tank-back" @click="backToList">
          <ArrowLeft :size="16" aria-hidden="true" />
          {{ t('agentTanks.back') }}
        </AppButton>
      </div>

      <p v-if="detailState === 'loading'" class="tp-status" role="status">{{ t('agentTanks.loading') }}</p>
      <EmptyState
        v-else-if="detailState === 'error'"
        role="alert"
        data-testid="tank-detail-error"
        :icon="TriangleAlert"
        :title="t('agentTanks.detail_error_title')"
        :description="detailError || t('agentTanks.error_desc')"
      >
        <AppButton variant="primary" @click="loadDetail(detailId)">
          <RotateCcw :size="16" aria-hidden="true" />
          {{ t('agentTanks.retry') }}
        </AppButton>
      </EmptyState>

      <template v-else-if="detail">
        <ShowcaseHero
          compact
          section="tankopedia"
          :kicker="t('nav.groups.reference')"
          :title="detail.name"
        />

        <Motion
          tag="header"
          class="tp-detail-head surface-glass-1"
          :initial="{ opacity: 0, y: 4 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="motionTransition('fast')"
        >
          <span class="tp-media tp-media-lg">
            <TankCoverNation :nation="detail.nation" />
            <img :src="tankImageUrl(detailId)" alt="" width="320" height="200" decoding="async" :style="iconCropStyle(detailId)" @error="hideBrokenImage">
          </span>
          <div class="tp-detail-title">
            <div class="tp-badges">
              <span class="tp-pill is-tier">{{ tierLabel(detail.tier) }}</span>
              <span class="tp-pill">{{ nationLabel(detail.nation) }}</span>
              <span class="tp-pill" :class="TYPE_CLS[detail.type] || 't-unknown'">{{ typeLabel(detail.type) }}</span>
              <span v-if="summary?.is_premium" class="tp-pill is-premium">{{ t('agentTanks.premium') }}</span>
            </div>
            <TankMechanicsChips :key="detailId" :mechanics="mechanicRows" />
          </div>
          <div v-if="modules && setup.canConfigure" class="tp-detail-actions">
            <AppButton variant="secondary" size="md" data-testid="tank-open-research" @click="researchOpen = true">
              <GitBranch :size="18" aria-hidden="true" />
              {{ t('research.open_research') }}
            </AppButton>
          </div>
        </Motion>

        <div class="tp-workbench">
          <div class="tp-workbench-left">
          <section class="tp-card-section tp-model-card surface-glass-1" data-testid="tank-open3d-card" data-tour="tankopedia-detail">
            <div class="tp-model-card-heading">
              <h2 class="tp-section-title">{{ t('agentTanks.open3d_title') }}</h2>
              <AppButton variant="primary" data-testid="tank-open3d" data-tour="tankopedia-armor" @click="open3d">
                <Box :size="16" aria-hidden="true" />
                {{ t('agentTanks.open3d') }}
              </AppButton>
            </div>
            <dl v-if="setup.canConfigure" class="tp-summary">
              <div v-if="currentTurret"><dt>{{ t('agentTanks.configurator.turret') }}</dt><dd>{{ moduleName(currentTurret) }}</dd></div>
              <div v-if="currentGun"><dt>{{ t('agentTanks.configurator.gun') }}</dt><dd>{{ moduleName(currentGun) }}</dd></div>
              <div v-if="currentEngine"><dt>{{ t('agentTanks.configurator.engine') }}</dt><dd>{{ moduleName(currentEngine) }}</dd></div>
              <div v-if="currentTrack"><dt>{{ t('agentTanks.configurator.track') }}</dt><dd>{{ moduleName(currentTrack) }}</dd></div>
            </dl>
            <label v-if="!setup.canConfigure && cfgs.length > 1" class="tp-field tp-field-inline">
              <span class="tp-field-label">{{ t('agentTanks.select_config') }}</span>
              <select v-model.number="cfgIdx" data-testid="tank-config">
                <option v-for="(c, i) in cfgs" :key="i" :value="i">{{ c.label }}<template v-if="c.turret_name && c.turret_name !== c.label"> ({{ c.turret_name }})</template></option>
              </select>
            </label>

            <p class="tp-muted">{{ t('agentTanks.open3d_hint') }}</p>
            <p v-if="Number(detail.tier) === 11 && !upgradeSelection.available" class="tp-muted" role="status" data-testid="tank-upgrade-unavailable">
              {{ t('agentTanks.configurator.upgrade_unavailable') }}
            </p>
          </section>

          <TankConfigPanel
            v-if="setup.canConfigure && catalog"
            :detail="detail"
            :modules="modules"
            :selection="setup"
            :catalog="catalog"
            :upgrade-supported="upgradeSelection.supported"
            @update="writeSetup"
            @reset="resetSetup"
            @preset="applyModulePreset"
            @cycle-skill="cycleSkill"
            @max-skills="maxSkills"
            @clear-skills="clearSkills"
          />
          </div>

        <AppDialog
          :open="researchOpen"
          :title="isXiResearch ? t('agentTanks.configurator.augment_title') : t('research.modules_title')"
          size="xl"
          data-testid="tank-research-dialog"
          @close="researchOpen = false"
        >
          <TankAugmentTree
            v-if="modules && setup.canConfigure && isXiResearch"
            :modules="modules"
            :installed="augmentInstalled"
            :chosen="augmentChosen"
            @research="onAugmentResearch"
            @research-all="onAugmentResearchAll"
            @research-none="onAugmentResearchNone"
          />
          <TankResearchPanel
            v-else-if="modules && setup.canConfigure"
            :detail="detail"
            :modules="modules"
            :selection="setup"
            :prev-vehicles="researchPrevVehicles"
            :next-vehicles="researchNextVehicles"
            @install="installFromGraph"
            @open-vehicle="openVehicleFromGraph"
          />
          <p v-else class="tp-muted">{{ t('research.modules_unavailable') }}</p>
        </AppDialog>

        <div class="tp-workbench-right">
        <TankParamPanel
          :preview-consumables="setup.consumables.length > 0"
          v-if="characteristics"
          :groups="paramTable"
          :current="characteristics"
          :base="previousCharacteristics || {}"
          :gun-meta="gunMeta"
          :pitch-limits="pitchLimits"
          :yaw-limits="yawLimits"
          :pitch-bonus="pitchBonus"
          :shells="shellRows"
          @select-shell="selectShell"
        />

        <section v-else class="tp-card-section surface-glass-1">
          <h2 class="tp-section-title">{{ t('agentTanks.mobility') }}</h2>
          <dl class="tp-stats">
            <div><dt>{{ t('agentTanks.hp') }}</dt><dd>{{ fmtNum(upgradeProjection.detail?.hp ?? detail.hp, 0) }}</dd></div>
            <div><dt>{{ t('agentTanks.speed_fwd') }}</dt><dd>{{ fmtNum(detail.speed_forward ?? summary?.speed_forward ?? detail.speed) }} km/h</dd></div>
            <div><dt>{{ t('agentTanks.speed_rev') }}</dt><dd>{{ fmtNum(detail.speed_reverse ?? summary?.speed_reverse) }} km/h</dd></div>
            <div><dt>{{ t('agentTanks.view_range') }}</dt><dd>{{ fmtNum(curCfg?.view_range ?? summary?.view_range, 0) }} m</dd></div>
            <div><dt>{{ t('agentTanks.hull_traverse') }}</dt><dd>{{ fmt(summary?.hull_traverse, 1) }} °/s</dd></div>
            <div><dt>{{ t('agentTanks.turret_traverse') }}</dt><dd>{{ fmt(curCfg?.turret_traverse_speed ?? summary?.turret_traverse_speed, 0) }} °/s</dd></div>
            <div><dt>{{ t('agentTanks.gun_dep_ele') }}</dt><dd>{{ fmtNum(gunDepression) }}° / {{ fmtNum(gunElevation) }}°</dd></div>
            <div v-if="curCfg?.reload_time != null"><dt>{{ t('agentTanks.reload') }}</dt><dd>{{ fmt(curCfg.reload_time, 1) }} s</dd></div>
            <div v-if="curCfg?.dpm != null"><dt>{{ t('agentTanks.dpm') }}</dt><dd>{{ fmt(curCfg.dpm, 0) }}</dd></div>
            <div v-if="curCfg?.aim_time != null"><dt>{{ t('agentTanks.aim_time') }}</dt><dd>{{ fmt(curCfg.aim_time, 1) }} s</dd></div>
          </dl>
        </section>

        <MobilityChart single :vehicles="[vehicle]" :dataset="dataset">
          <AppButton :disabled="!dataset || !setup.canConfigure" @click="openMobility(true)">{{ t('mobility.join') }}</AppButton>
        </MobilityChart>
        <MobilityActivations v-model="activations" :options="vehicle.options" :catalog="catalog" />
        </div>

        </div>

        <section v-if="!characteristics" class="tp-card-section surface-glass-1">
          <h2 class="tp-section-title">{{ t('agentTanks.shells') }}</h2>
          <div class="tp-table-wrap">
            <table class="tp-table">
              <thead>
                <tr>
                  <th scope="col">{{ t('agentTanks.shell') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.pen') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.dmg') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.pen_far') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.velocity') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.module_dmg') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.normalization') }}</th>
                  <th scope="col" class="is-num">{{ t('agentTanks.ricochet') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in shellRows" :key="s.index">
                  <td><span class="tp-pill is-shell" :class="{ 'is-premium': s.premium }">{{ s.label }}</span></td>
                  <td class="is-num">{{ fmtNum(s.tunedPenetration) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedDamage, 0) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedPenetrationFar) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedVelocity) }}</td>
                  <td class="is-num">{{ fmtNum(s.tunedModuleDamage, 0) }}</td>
                  <td class="is-num">{{ fmtNum(s.normalization, 0) }}°</td>
                  <td class="is-num">{{ fmtNum(s.ricochet, 0) }}°</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>

    <ShowcaseHero v-if="listMounted" v-show="detailId == null" section="tankopedia" :kicker="t('nav.groups.reference')" :title="t('agentTanks.title')" :description="t('agentTanks.hint')">
      <template v-if="tanks.length" #stats><div><span class="tp-hero-stat-label">{{ t('tankopedia.heroCount') }}</span><strong data-testid="tankopedia-count">{{ tanks.length.toLocaleString(locale) }}</strong></div></template>
      <template #actions>
        <AppButton v-if="detailId == null" @click="openMobility(false)">{{ t('mobility.compare') }}</AppButton>
        <AppButton
          v-if="detailId == null"
          variant="primary"
          data-testid="tankopedia-techtree"
          @click="openTechTree"
        >
          <Network :size="18" aria-hidden="true" />
          {{ t('research.open_techtree') }}
        </AppButton>
      </template>
    </ShowcaseHero>
    <TankCatalogMenu
      v-if="listMounted"
      v-show="detailId == null"
      :tanks="tanks"
      :state="listState"
      :error="listError"
      :filters="listFilters"
      @update:filters="writeFilters"
      @select="tank => openDetail(tank.id)"
      @retry="loadList"
    />
  </section>
</template>

<style scoped src="./tankopedia.css"></style>
