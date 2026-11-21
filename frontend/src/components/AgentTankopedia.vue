<script setup>
/**
 * 坦克百科（?view=agent-tankopedia，2026-10-01 起对所有用户公开）：列表 + 详情两态。
 * 数据面：tank_cache.json（列表/概要）+ tank/{id}.json（详情，configs/armor_model/shells）
 * 经 agentData → assetProvider 走配置的 remote asset origin（client-only，无同源回退）。
 *
 * URL 是筛选 / 详情状态的唯一 owner（utils/tankopediaQuery.js 解析与序列化）：
 * q / tier / nation / type / category / sort 用 replace 写入（不堆历史），?tank= 详情用 push（返回键回到列表），
 * ?config= 记录详情页选中的配置下标并联动装甲查看器入口。
 * 列表增量渲染（审计 3D-18）：首屏一页，滚动到底由 IntersectionObserver 追加，按钮兜底。
 * 坦克百科中的 3D 检视入口保留当前角色显示策略；装甲页面本身只要求登录。
 */
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
import TankConfigPanel from './TankConfigPanel.vue'
import TankResearchPanel from './TankResearchPanel.vue'
import TankAugmentTree from './TankAugmentTree.vue'
import MobilityChart from './MobilityChart.vue'
import MobilityActivations from './MobilityActivations.vue'
import { mobilityVehicle, saveComparison, snapshot, useMobilityDataset, describeSetup } from '../composables/tankMobility'
import TankParamPanel from './TankParamPanel.vue'
import AppDialog from './AppDialog.vue'
import { Motion } from 'motion-v'
import { motionTransition } from '../shared/motion/motionPolicy'

const VIEW = 'agent-tankopedia'
/** 车种枚举 → i18n 键（AT-SPG 含连字符，不直接作键） */

const { t, te, locale } = useI18n()
const route = useRoute()
const router = useRouter()

// ---------- URL 状态（唯一 owner） ----------
/** 已提交但可能尚未落到 route.query 的最近一次写入：在同一 tick / 同一次点击里连写两次
 *  （研发弹窗里点模块、紧接着再点）时，第二次若仍以 route.query 为底就会覆盖第一击。 */
const pendingQuery = ref(null)
const effectiveQuery = computed(() => pendingQuery.value || route.query)
const urlState = computed(() => parseTankopediaQuery(effectiveQuery.value))
const onView = () => route.query?.view === VIEW
// 导航落地后 URL 重新成为唯一事实来源
watch(() => route.query, () => { pendingQuery.value = null }, { flush: 'sync' })

function writeState(patch, { push = false } = {}) {
  if (!onView()) return
  const base = effectiveQuery.value
  const query = withTankopediaState(base, { ...urlState.value, ...patch })
  if (sameTankopediaQuery(base, query)) return
  pendingQuery.value = query
  router[push ? 'push' : 'replace']({ query })
}

// 搜索 / 筛选 / 排序的唯一实现是 TankCatalogMenu（与装甲查看器选车弹窗共用）：
// 本页只负责 URL 状态与详情；组件内的输入草稿即时筛选，防抖后通过 update:filters 提交。
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

// ---------- 显示名（审计 3D-16：不直接显示 china / heavyTank 等原始值） ----------
const nationLabel = nation => tankNationLabel(t, te, nation)
const typeLabel = type => tankTypeLabel(t, te, type)
const tierLabel = tier => romanLevel(tier)

// ---------- 列表态 ----------
const cache = ref({})
const listState = ref('loading')   // loading | ready | error
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
  // upgrade:null = 交给 resolveUpgradeSelection 按 tier 取默认（XI→top，其他→stock）。
  writeState({ tank: id, config: null, upgrade: null, abilities: [] }, { push: true })
}
function backToList() {
  // In-app back must collapse the detail history entry instead of adding another one.
  // Otherwise list → detail → in-app back → browser Back re-opens the same detail.
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
  shellRows, moduleName, currentTurret, currentGun, currentEngine, currentTrack,
  gunMeta, yawLimits, pitchBonus,
  applyModulePreset, writeSetup, selectShell, cycleSkill, maxSkills, clearSkills, resetSetup,
  configForArmor,
} = setupModel

// 列表在详情往返期间保持挂载：TankCatalogMenu 内部保存增量条数与搜索草稿
//（组件卸载会清掉防抖 timer，详情期间提交的 q 也会丢）。直达详情时不提前挂载列表，
// 避免隐藏卡片发图片请求；返回列表时再挂载。
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
  // 科技树入口：locationForView 保留 assets/lang 等与视图无关的键。
  const dest = locationForView('agent-techtree', route)
  router.push({ path: dest.path, query: { ...dest.query, view: 'agent-techtree' } })
}

function open3d() {  // 审计 3D-09：在当前标签页打开装甲查看器（携带实际搭载配置下标），返回走浏览器历史
  // 走 locationForView：它按"离开坦克百科"删掉列表筛选（nation/q/…），同时保留
  // 与视图无关的键（`assets` 资产源 override、`lang`、`admin` 等）——此前手写的
  // `query: { view, tank, config }` 会把 `assets` 一并丢掉，导致进入装甲查看器后
  // 资产源回落（模型/贴图加载不到）。
  // 配置器可用时把装备/物品选择一并带上（dev/cons/prov），并把装甲查看器只认的两个
  // 射击相关装备折成 eqcal/eqenh（103 校准弹 / 110 强化装甲）——装甲页不再展示完整装备。
  const dest = locationForView('agent-armor', route)
  const handoff = setup.value.canConfigure
    ? {
        ...(upgradeSelection.value.available ? {
          // 显式传递模式（装甲页按同一 resolveSetup 口径解析 custom+abilities）：
          // stock 必须写成 upgrade=stock 才能保留；custom 必须连 abilities 一起带，
          // 否则部分研发语义丢失、装甲/火炮数值会按整套 top 静默展示。
          upgrade: setup.value.upgrade ?? 'top',
          ...(setup.value.abilities?.length ? { abilities: setup.value.abilities.join(',') } : {}),
        } : {}),
        dev: encodeDevices(setup.value.devices),
        cons: setup.value.consumables.join(','),
        prov: setup.value.provisions.join(','),
        ...(deviceIds.value.has(103) ? { eqcal: '1' } : {}),
        ...(deviceIds.value.has(110) ? { eqenh: '1' } : {}),
        // 122 改进型垂直稳定器：装甲查看器初始化 122 what-if 读的是 eqpitch，
        // 只带 dev= 不会自动推导——配置器选了 122 必须折成 eqpitch=1，否则
        // 进入装甲页后拖炮仍按基础俯仰扇区限制。
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
  // 封面缺失：保留固定比例的占位框，不显示破图标
  event.target.hidden = true
}

// 封面图展示裁剪：客户端图标是原始画布（坦克锚定左上、右侧/底部留白近半），
// 按数据面的逐车内容框缩放定位（utils/tankIconCrop.js），视觉对齐旧紧裁口径；
// 数据缺失（旧包/资产源未配置）时 transform 为空串 → 回退原始 contain 展示。
const ICON_BOX_ASPECT = 8 / 5 // 与 .tp-media 的 aspect-ratio 一致
const iconCrops = ref(null)
loadTankIconCrops().then((crops) => { iconCrops.value = crops })
function iconCropStyle(id) {
  const transform = tankIconCropTransform(iconCrops.value?.[String(id)], ICON_BOX_ASPECT)
  return transform ? { transform } : null
}

onMounted(() => {
  loadList()
  if (detailId.value != null) loadDetail(detailId.value)   // 详情直达（刷新 / 分享链接）
})
</script>

<template>
  <section class="tankopedia" data-testid="tankopedia">
    <!-- ================= 详情态 ================= -->
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
            <img :src="tankImageUrl(detailId)" alt="" width="320" height="200" decoding="async" :style="iconCropStyle(detailId)" @error="hideBrokenImage">
          </span>
          <div class="tp-detail-title">
            <div class="tp-badges">
              <span class="tp-pill is-tier">{{ tierLabel(detail.tier) }}</span>
              <span class="tp-pill">{{ nationLabel(detail.nation) }}</span>
              <span class="tp-pill" :class="TYPE_CLS[detail.type] || 't-unknown'">{{ typeLabel(detail.type) }}</span>
              <span v-if="summary?.is_premium" class="tp-pill is-premium">{{ t('agentTanks.premium') }}</span>
            </div>
          </div>
          <div v-if="modules && setup.canConfigure" class="tp-detail-actions">
            <AppButton
              variant="secondary"
              size="md"
              data-testid="tank-open-research"
              @click="researchOpen = true"
            >
              <GitBranch :size="18" aria-hidden="true" />
              {{ t('research.open_research') }}
            </AppButton>
          </div>
        </Motion>

        <!-- 工作台：左 = 模型入口 + 配置面板，右 = 参数区（BlitzKit 式两栏）。
             参数卡片顺序：防护 → 机动 → 火力（火力卡内弹种选择置顶）。 -->
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

        <!-- 研发弹窗：客户端 ModulesTree 的形态；改动与背后的配置栏同源（URL） -->
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

        <!-- 无模块数据的静态详情：保留只读弹种表（可配置时弹种表已并入火力卡） -->
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

    <!-- ================= 列表态 ================= -->
    <!-- v-if：直达详情不提前挂载；v-show：列表→详情→返回保留增量条数与搜索草稿 -->
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
