<script setup>
/**
 * 坦克百科（?view=agent-tankopedia，2026-10-01 起对所有用户公开）：列表 + 详情两态。
 * 数据面：tank_cache.json（列表/概要）+ tank/{id}.json（详情，configs/armor_model/shells）
 * 经 agentData → assetProvider 走配置的 remote asset origin（client-only，无同源回退）。
 *
 * URL 是筛选 / 详情状态的唯一 owner（utils/tankopediaQuery.js 解析与序列化）：
 * q / tier / nation / type / sort 用 replace 写入（不堆历史），?tank= 详情用 push（返回键回到列表），
 * ?config= 记录详情页选中的配置下标并联动装甲查看器入口。
 * 列表增量渲染（审计 3D-18）：首屏一页，滚动到底由 IntersectionObserver 追加，按钮兜底。
 * 坦克百科中的 3D 检视入口保留当前角色显示策略；装甲页面本身只要求登录。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { locationForView } from '../app/navigation'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Box, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { fetchTankEncyclopedia, fetchTankData, tankImageUrl, loadTankIconCrops } from '../scene/agentData.js'
import { tankIconCropTransform } from '../utils/tankIconCrop.js'
import { TYPE_CLS, normType, shellLabel, isPremiumShell, fmt, fmtNum, tankNationLabel, tankTypeLabel } from '../scene/tankMeta.js'
import {
  normalizeTankCache, parseTankopediaQuery, sameTankopediaQuery, withTankopediaState,
} from '../utils/tankopediaQuery.js'
import PageHeader from './PageHeader.vue'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import { Motion } from 'motion-v'
import { motionTransition } from '../shared/motion/motionPolicy'

const VIEW = 'agent-tankopedia'
/** 车种枚举 → i18n 键（AT-SPG 含连字符，不直接作键） */

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()

// ---------- URL 状态（唯一 owner） ----------
const urlState = computed(() => parseTankopediaQuery(route.query))
const onView = () => route.query?.view === VIEW

function writeState(patch, { push = false } = {}) {
  if (!onView()) return
  const query = withTankopediaState(route.query, { ...urlState.value, ...patch })
  if (sameTankopediaQuery(route.query, query)) return
  router[push ? 'push' : 'replace']({ query })
}

// 搜索 / 筛选 / 排序的唯一实现是 TankCatalogMenu（与装甲查看器选车弹窗共用）：
// 本页只负责 URL 状态与详情；组件内的输入草稿即时筛选，防抖后通过 update:filters 提交。
const listFilters = computed(() => ({
  q: urlState.value.q,
  tier: urlState.value.tier,
  nation: urlState.value.nation,
  type: urlState.value.type,
  sort: urlState.value.sort,
}))
function writeFilters(filters) {
  writeState({
    q: filters.q,
    tier: filters.tier,
    nation: filters.nation,
    type: filters.type,
    sort: filters.sort,
  })
}

// ---------- 显示名（审计 3D-16：不直接显示 china / heavyTank 等原始值） ----------
const nationLabel = nation => tankNationLabel(t, te, nation)
const typeLabel = type => tankTypeLabel(t, te, type)
const tierLabel = tier => t('agentTanks.tier_n', { tier })

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
  writeState({ tank: id, config: null }, { push: true })
}
function backToList() {
  // In-app back must collapse the detail history entry instead of adding another one.
  // Otherwise list → detail → in-app back → browser Back re-opens the same detail.
  writeState({ tank: null, config: null })
}

// ---------- 详情态（?tank=；数据 = tank/{id}.json + tank_cache 概要） ----------
const detailId = computed(() => urlState.value.tank)
const detail = ref(null)
const detailState = ref('idle')   // idle | loading | ready | error
const detailError = ref('')
let detailRequest = 0

const summary = computed(() => (detailId.value != null ? cache.value?.[String(detailId.value)] || null : null))
const cfgs = computed(() => detail.value?.configs || [])
/** 默认顶级变体（末位），与查看器 defaultCfg 语义一致；URL ?config= 优先 */
const cfgIdx = computed({
  get: () => {
    const count = cfgs.value.length
    if (!count) return 0
    const wanted = urlState.value.config
    return wanted != null && wanted < count ? wanted : count - 1
  },
  set: value => writeState({ config: Number(value) }),
})
const curCfg = computed(() => cfgs.value[cfgIdx.value] || null)
const shells = computed(() => curCfg.value?.shells || detail.value?.shells || [])

/**
 * 俯角/仰角显示回退链：per-tank 数据 → tank_cache 概要 → 当前配置 pitch_limits。
 * 前两者取决于资产包生成时间，配置级 pitch_limits（models.pb 直取）只要配置有数据就有值，
 * 是数据面缺字段时的兜底——与 GunPitchRange 同一约定：dep = max、ele = −min。
 */
const pitchLimits = computed(() => curCfg.value?.pitch_limits || null)
const gunDepression = computed(() =>
  detail.value?.gun_depression ?? summary.value?.gun_depression ?? pitchLimits.value?.max ?? null)
const gunElevation = computed(() => {
  const ele = detail.value?.gun_elevation ?? summary.value?.gun_elevation
  if (ele != null) return ele
  return pitchLimits.value?.min != null ? -pitchLimits.value.min : null
})

async function loadDetail(id) {
  const request = ++detailRequest
  if (id == null) {
    detail.value = null
    detailState.value = 'idle'
    return
  }
  detailState.value = 'loading'
  detailError.value = ''
  detail.value = null
  try {
    const data = await fetchTankData(id)
    if (request !== detailRequest) return
    detail.value = data
    detailState.value = 'ready'
  } catch (e) {
    if (request !== detailRequest) return
    detailError.value = String(e?.message || e)
    detailState.value = 'error'
  }
}
watch(detailId, id => loadDetail(id))

// 列表在详情往返期间保持挂载：TankCatalogMenu 内部保存增量条数与搜索草稿
//（组件卸载会清掉防抖 timer，详情期间提交的 q 也会丢）。直达详情时不提前挂载列表，
// 避免隐藏卡片发图片请求；返回列表时再挂载。
const listMounted = ref(detailId.value == null)
watch(detailId, id => { if (id == null) listMounted.value = true })

function open3d() {
  // 审计 3D-09：在当前标签页打开装甲查看器（携带实际搭载配置下标），返回走浏览器历史
  // 走 locationForView：它按"离开坦克百科"删掉列表筛选（nation/q/…），同时保留
  // 与视图无关的键（`assets` 资产源 override、`lang`、`admin` 等）——此前手写的
  // `query: { view, tank, config }` 会把 `assets` 一并丢掉，导致进入装甲查看器后
  // 资产源回落（模型/贴图加载不到）。
  const dest = locationForView('agent-armor', route)
  router.push({
    path: dest.path,
    query: { ...dest.query, view: 'agent-armor', tank: String(detailId.value), config: String(cfgIdx.value) },
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
        <Motion
          tag="header"
          class="tp-detail-head"
          :initial="{ opacity: 0, y: 4 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="motionTransition('fast')"
        >
          <span class="tp-media tp-media-lg">
            <img :src="tankImageUrl(detailId)" alt="" width="320" height="200" decoding="async" :style="iconCropStyle(detailId)" @error="hideBrokenImage">
          </span>
          <div class="tp-detail-title">
            <h1>{{ detail.name }}</h1>
            <div class="tp-badges">
              <span class="tp-pill is-tier">{{ tierLabel(detail.tier) }}</span>
              <span class="tp-pill">{{ nationLabel(detail.nation) }}</span>
              <span class="tp-pill" :class="TYPE_CLS[detail.type] || 't-unknown'">{{ typeLabel(detail.type) }}</span>
              <span v-if="summary?.is_premium" class="tp-pill is-premium">{{ t('agentTanks.premium') }}</span>
            </div>
          </div>
        </Motion>

        <!-- 装甲查看器入口：装甲数值 / 热力 / 等效判定以查看器为准（唯一装甲事实源）；查看器匿名可用，入口对全员开放 -->
        <section class="tp-card-section" data-testid="tank-open3d-card" data-tour="tankopedia-detail">
          <h2 class="tp-section-title">{{ t('agentTanks.open3d_title') }}</h2>
          <label v-if="cfgs.length > 1" class="tp-field tp-field-inline">
            <span class="tp-field-label">{{ t('agentTanks.select_config') }}</span>
            <select v-model.number="cfgIdx" data-testid="tank-config">
              <option v-for="(c, i) in cfgs" :key="i" :value="i">{{ c.label }}<template v-if="c.turret_name && c.turret_name !== c.label"> ({{ c.turret_name }})</template></option>
            </select>
          </label>
          <div>
            <AppButton variant="primary" data-testid="tank-open3d" data-tour="tankopedia-armor" @click="open3d">
              <Box :size="16" aria-hidden="true" />
              {{ t('agentTanks.open3d') }}
            </AppButton>
          </div>
          <p class="tp-muted">{{ t('agentTanks.open3d_hint') }}</p>
        </section>

        <section class="tp-card-section">
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
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in shells" :key="i">
                  <td><span class="tp-pill is-shell" :class="{ 'is-premium': isPremiumShell(s) }">{{ shellLabel(s) || normType(s.type) }}</span></td>
                  <td class="is-num">{{ fmtNum(s.penetration) }}</td>
                  <td class="is-num">{{ fmtNum(s.damage) }}</td>
                  <td class="is-num">{{ fmtNum(s.penetration_far) }}</td>
                  <td class="is-num">{{ fmtNum(s.velocity) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="tp-card-section">
          <h2 class="tp-section-title">{{ t('agentTanks.mobility') }}</h2>
          <dl class="tp-stats">
            <div><dt>{{ t('agentTanks.hp') }}</dt><dd>{{ fmtNum(detail.hp, 0) }}</dd></div>
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
      </template>
    </template>

    <!-- ================= 列表态 ================= -->
    <!-- v-if：直达详情不提前挂载；v-show：列表→详情→返回保留增量条数与搜索草稿 -->
    <PageHeader v-if="listMounted" v-show="detailId == null" :title="t('agentTanks.title')" :description="t('agentTanks.hint')" />
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

<style scoped>
.tankopedia {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--gutter) var(--space-12);
  color: var(--color-text-primary);
}

.tankopedia :deep(.page-header) { margin-bottom: 0; }

.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-status { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }

/* 详情页配置选择（列表的搜索/筛选/排序在 TankCatalogMenu 内，单一实现） */
.tp-field { display: grid; gap: var(--space-1); min-inline-size: 140px; }
.tp-field-inline { max-inline-size: 360px; }
.tp-field-label { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-field select {
  inline-size: 100%;
  min-block-size: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}
.tp-field select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* 固定比例的图片框：懒加载图片到达前后都不引起布局位移 */
.tp-media {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 8 / 5;
  inline-size: 100%;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}

/* 图片必须**绝对定位铺满**，不能让它在网格里按 `block-size:100%` 自适应。
 *
 * 容器是 `display:grid` + `place-items:center`：网格区域按内容 sizing，`block-size:100%`
 * 解不出确定高度，于是 img 退回**固有比例**——封面图是逐车紧裁的（高固定、宽 84~190），
 * 窄于 8:5 的车会算得比容器更高（实测列表卡片 164.8×103 的框里 img 是 164.8×133.5，
 * 详情 hero 240×150 里是 240×156.9），多出来的部分被容器的 `overflow:hidden`
 * **从下方裁掉**（履带/车体下缘被切）。
 * 绝对定位后 img 盒恒等于容器盒，`contain` 完整装下整张图，不再裁切。 */
.tp-media img {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}

.tp-badges { display: flex; flex-wrap: wrap; gap: var(--space-1); }

.tp-pill {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  white-space: nowrap;
}

.tp-pill.is-tier,
.tp-pill.is-premium { background: color-mix(in oklab, var(--color-warning) 16%, var(--color-surface-1)); color: var(--color-warning); }
.tp-pill.t-light { background: color-mix(in oklab, var(--color-success) 16%, var(--color-surface-1)); color: var(--color-success); }
.tp-pill.t-medium { background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); color: var(--color-accent-text); }
.tp-pill.t-heavy { background: color-mix(in oklab, var(--color-danger) 16%, var(--color-surface-1)); color: var(--color-danger); }
.tp-pill.t-td { background: color-mix(in oklab, var(--color-info) 16%, var(--color-surface-1)); color: var(--color-info); }
.tp-pill.is-shell { background: color-mix(in oklab, var(--color-info) 14%, var(--color-surface-1)); color: var(--color-info); }
.tp-pill.is-shell.is-premium { background: color-mix(in oklab, var(--color-warning) 16%, var(--color-surface-1)); color: var(--color-warning); }

/* ---------- 详情态 ---------- */
.tp-detail-nav { display: flex; }

.tp-detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.tp-media-lg { flex: 0 0 240px; inline-size: 240px; }
.tp-detail-title { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tp-detail-title h1 { margin: 0; font: var(--type-h1); overflow-wrap: anywhere; }

.tp-card-section {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.tp-section-title { margin: 0; font: var(--type-h3); }

.tp-table-wrap { overflow-x: auto; }
.tp-table { inline-size: 100%; border-collapse: collapse; font: var(--type-body); font-variant-numeric: tabular-nums; }
.tp-table th { padding: var(--space-1) var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; text-align: start; white-space: nowrap; }
.tp-table td { padding: var(--space-2); border-block-start: 1px solid var(--color-border-subtle); }
.tp-table .is-num { text-align: end; }

.tp-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-2);
  margin: 0;
}

.tp-stats > div { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
.tp-stats dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-stats dd { margin: 0; font: var(--type-h3); font-variant-numeric: tabular-nums; }

/* 平板：详情头部封面缩小 */
@media (768px <= width < 1200px) {
  .tp-media-lg { flex-basis: 200px; inline-size: 200px; }
}

/* 手机：详情头部改为上下排列 */
@media (width < 768px) {
  .tankopedia { gap: var(--space-3); padding-block-start: var(--space-4); }
  .tp-detail-head { flex-direction: column; align-items: stretch; gap: var(--space-3); }
  .tp-media-lg { flex-basis: auto; inline-size: 100%; }
  .tp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
