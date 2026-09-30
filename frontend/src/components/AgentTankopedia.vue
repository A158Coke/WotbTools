<script setup>
/**
 * Agent 坦克百科（?view=agent-tankopedia）：列表 + 详情两态，逻辑对齐 wotbagent——
 * 卡片 → 详情页 → 详情页内"3D 装甲检视器"入口（装甲查看器无顶层入口，评审 UI 对齐）。
 * 数据面：tank_cache.json（列表/概要）+ tank/{id}.json（详情，configs/armor_model/shells）
 * 经 agentData 静态资产平面（?assets= / 同源回退）。
 * 详情态由 URL ?tank={id} 承载（可刷新/可分享）；?config= 下标联动 3D 入口（上游同参）。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { fetchTankEncyclopedia, fetchTankData, tankImageUrl } from '../scene/agentData.js'
import {
  tankFuzzyScore, TYPE_LABEL, TYPE_CLS, NATION_LABEL,
  normType, shellLabel, isPremiumShell, fmt,
} from '../scene/tankMeta.js'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// ---------- 列表态 ----------
const cache = ref({})
const loaded = ref(false)
const gridError = ref('')

const q = ref('')
const tier = ref('')
const nation = ref('')
const type = ref('')
const sort = ref('name')

const tanks = computed(() =>
  Object.entries(cache.value).map(([id, v]) => ({
    id: Number(id),
    name: v.name || '',
    tier: v.tier ?? 0,
    nation: v.nation || 'unknown',
    type: v.type || 'unknown',
    is_premium: !!v.is_premium,
    hp: v.hp ?? null,
    pen_max: Array.isArray(v.shells) ? Math.max(0, ...v.shells.map((s) => s.penetration || 0)) || null : null,
  })),
)

const tiers = computed(() => [...new Set(tanks.value.map((t) => t.tier))].filter(Boolean).sort((a, b) => a - b))
const nations = computed(() => [...new Set(tanks.value.map((t) => t.nation))].sort())
const types = computed(() => [...new Set(tanks.value.map((t) => t.type))].sort())

const filtered = computed(() => {
  const base = tanks.value.filter((tc) =>
    (!tier.value || String(tc.tier) === tier.value) &&
    (!nation.value || tc.nation === nation.value) &&
    (!type.value || tc.type === type.value),
  )
  if (!q.value.trim()) return base
  const query = q.value.trim().toLowerCase()
  return base
    .map((tc) => ({ tc, s: tankFuzzyScore(tc.name, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.tc.name || '').localeCompare(b.tc.name || ''))
    .map((x) => x.tc)
})

const sorted = computed(() => {
  const byNum = (key) => (a, b) => (b[key] ?? -1) - (a[key] ?? -1) || (a.name || '').localeCompare(b.name || '')
  const cmp = {
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    tier: (a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (a.name || '').localeCompare(b.name || ''),
    hp: byNum('hp'),
    pen: byNum('pen_max'),
  }[sort.value] || ((a, b) => (a.name || '').localeCompare(b.name || ''))
  return filtered.value.slice().sort(cmp)
})

function openDetail(id) {
  router.push({ query: { ...route.query, tank: String(id) } })
}
function backToList() {
  const query = { ...route.query }
  delete query.tank
  delete query.config
  router.push({ query })
}

// ---------- 详情态（?tank=；数据 = tank/{id}.json + tank_cache 概要） ----------
const detailId = computed(() => (route.query.tank ? Number(route.query.tank) : null))
const detail = ref(null)          // tank/{id}.json（configs/armor_model/shells/…）
const detailLoading = ref(false)
const detailError = ref('')
const cfgIdx = ref(0)             // 选中配置下标（联动 3D 入口 ?config=）

const summary = computed(() => (detailId.value != null ? cache.value[String(detailId.value)] || null : null))
const cfgs = computed(() => detail.value?.configs || [])
const curCfg = computed(() => (cfgs.value.length ? cfgs.value[Math.min(cfgIdx.value, cfgs.value.length - 1)] : null))

async function loadDetail(id) {
  if (id == null) { detail.value = null; detailError.value = ''; return }
  detailLoading.value = true
  detailError.value = ''
  detail.value = null
  try {
    detail.value = await fetchTankData(id)
    // 默认顶级变体（末位），与查看器 defaultCfg 语义一致
    cfgIdx.value = Math.max(0, (detail.value.configs?.length || 1) - 1)
  } catch (e) {
    detailError.value = (t('agentTanks.error_load') || '加载失败') + ': ' + (e?.message || e)
  } finally {
    detailLoading.value = false
  }
}
watch(detailId, loadDetail, { immediate: false })

function open3d() {
  // wotbagent 同参：新窗口 3D 检视器，携带实际搭载配置下标
  window.open(`/?view=agent-armor&tank=${detailId.value}&config=${cfgIdx.value}`, '_blank')
}

onMounted(async () => {
  gridError.value = ''
  try {
    const data = await fetchTankEncyclopedia()
    cache.value = Array.isArray(data)
      ? Object.fromEntries(data.map((tc) => [String(tc.id), tc]))
      : data
    loaded.value = true
    if (detailId.value != null) loadDetail(detailId.value)   // 详情直达（刷新/分享链接）
  } catch (e) {
    console.error('agent tankopedia load failed:', e)
    gridError.value = (t('agentTanks.error_load') || '加载失败') + ': ' + (e?.message || e)
  }
})
</script>

<template>
  <section class="agent-tanks">
    <!-- ================= 详情态 ================= -->
    <template v-if="detailId != null">
      <a class="back" href="#" @click.prevent="backToList">{{ t('agentTanks.back') }}</a>

      <div v-if="detailLoading" class="status">{{ t('agentTanks.loading') }}</div>
      <div v-else-if="detailError" class="status error">{{ detailError }}</div>

      <template v-else-if="detail">
        <!-- 头部：封面 + 名称 + 徽章（wotbagent md-head 同构） -->
        <div class="d-head">
          <img :src="tankImageUrl(detailId)" alt="">
          <div class="d-title">
            <h2>{{ detail.name }}</h2>
            <div class="badges">
              <span class="pill tier">T{{ detail.tier }}</span>
              <span class="pill nat">{{ NATION_LABEL[detail.nation] || detail.nation }}</span>
              <span class="pill" :class="TYPE_CLS[detail.type] || 't-unknown'">{{ TYPE_LABEL[detail.type] || detail.type }}</span>
              <span v-if="summary?.is_premium" class="pill gold">Premium</span>
            </div>
          </div>
        </div>

        <!-- 3D 装甲检视器入口（wotbagent open3d 同逻辑：新窗口 + config 参数）。
             装甲数据不在百科页呈现——数值/热力/等效判定以 3D 检视器为准（唯一装甲事实源） -->
        <div class="d-card">
          <div class="sec-title">{{ t('agentTanks.open3d_title') }}</div>
          <div class="cfg-row" v-if="cfgs.length > 1">
            <span class="dim">{{ t('agentTanks.select_config') }}</span>
            <select v-model.number="cfgIdx">
              <option v-for="(c, i) in cfgs" :key="i" :value="i">{{ c.label }}<template v-if="c.turret_name && c.turret_name !== c.label"> ({{ c.turret_name }})</template></option>
            </select>
          </div>
          <button class="open3d" @click="open3d">🔍 {{ t('agentTanks.open3d') }}</button>
          <div class="muted small" style="margin-top:8px;">{{ t('agentTanks.open3d_hint') }}</div>
        </div>

        <!-- 弹种表（选中配置弹链，wotbagent 弹药卡同构） -->
        <div class="d-card">
          <div class="sec-title">{{ t('agentTanks.shells') }}</div>
          <table class="shell-table">
            <thead>
              <tr>
                <th>{{ t('agentTanks.shell') }}</th><th>{{ t('agentTanks.pen') }}</th><th>{{ t('agentTanks.dmg') }}</th>
                <th class="hide-sm">{{ t('agentTanks.pen_far') }}</th><th class="hide-sm">{{ t('agentTanks.velocity') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in curCfg?.shells || detail.shells || []" :key="i">
                <td><span class="pill shell" :class="{ gold: isPremiumShell(s) }">{{ shellLabel(s) || normType(s.type) }}</span></td>
                <td>{{ s.penetration ?? '-' }}</td>
                <td>{{ s.damage ?? '-' }}</td>
                <td class="hide-sm">{{ s.penetration_far ?? '-' }}</td>
                <td class="hide-sm">{{ s.velocity ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 机动/火控 -->
        <div class="d-card">
          <div class="sec-title">{{ t('agentTanks.mobility') }}</div>
          <div class="stat-grid">
            <div class="stat-box"><div class="lbl">{{ t('agentTanks.hp') }}</div><div class="val">{{ detail.hp ?? '-' }}</div></div>
            <div class="stat-box"><div class="lbl">{{ t('agentTanks.speed_fwd') }}</div><div class="val">{{ detail.speed_forward ?? detail.speed?.forward ?? '-' }} km/h</div></div>
            <div class="stat-box"><div class="lbl">{{ t('agentTanks.speed_rev') }}</div><div class="val">{{ detail.speed_reverse ?? detail.speed?.reverse ?? '-' }} km/h</div></div>
            <div class="stat-box"><div class="lbl">{{ t('agentTanks.view_range') }}</div><div class="val">{{ curCfg?.view_range ?? summary?.view_range ?? '-' }} m</div></div>
            <div class="stat-box"><div class="lbl">{{ t('agentTanks.hull_traverse') }}</div><div class="val">{{ fmt(summary?.hull_traverse, 1) }} °/s</div></div>
            <div class="stat-box"><div class="lbl">{{ t('agentTanks.turret_traverse') }}</div><div class="val">{{ fmt(curCfg?.turret_traverse_speed ?? summary?.turret_traverse_speed, 0) }} °/s</div></div>
            <div class="stat-box"><div class="lbl">{{ t('agentTanks.gun_dep_ele') }}</div><div class="val">{{ detail.gun_depression ?? summary?.gun_depression ?? '-' }}° / {{ detail.gun_elevation ?? summary?.gun_elevation ?? '-' }}°</div></div>
            <div class="stat-box" v-if="curCfg?.reload_time != null"><div class="lbl">{{ t('agentTanks.reload') }}</div><div class="val">{{ fmt(curCfg.reload_time, 1) }} s</div></div>
            <div class="stat-box" v-if="curCfg?.dpm != null"><div class="lbl">DPM</div><div class="val">{{ fmt(curCfg.dpm, 0) }}</div></div>
            <div class="stat-box" v-if="curCfg?.aim_time != null"><div class="lbl">{{ t('agentTanks.aim_time') }}</div><div class="val">{{ fmt(curCfg.aim_time, 1) }} s</div></div>
          </div>
        </div>
      </template>
    </template>

    <!-- ================= 列表态 ================= -->
    <template v-else>
      <h2>{{ t('agentTanks.title') }}</h2>
      <p class="hint">{{ t('agentTanks.hint') }}</p>

      <div class="toolbar">
        <input v-model="q" class="search" :placeholder="t('agentTanks.search_ph')" />
        <select v-model="tier">
          <option value="">{{ t('agentTanks.tier') }}</option>
          <option v-for="tv in tiers" :key="tv" :value="String(tv)">Tier {{ tv }}</option>
        </select>
        <select v-model="nation">
          <option value="">{{ t('agentTanks.nation') }}</option>
          <option v-for="n in nations" :key="n" :value="n">{{ NATION_LABEL[n] || n }}</option>
        </select>
        <select v-model="type">
          <option value="">{{ t('agentTanks.type') }}</option>
          <option v-for="tv in types" :key="tv" :value="tv">{{ TYPE_LABEL[tv] || tv }}</option>
        </select>
        <select v-model="sort">
          <option value="name">{{ t('agentTanks.sort_name') }}</option>
          <option value="tier">{{ t('agentTanks.sort_tier') }}</option>
          <option value="hp">{{ t('agentTanks.sort_hp') }}</option>
          <option value="pen">{{ t('agentTanks.sort_pen') }}</option>
        </select>
        <span class="count">{{ gridError ? '' : `${sorted.length} / ${tanks.length}` }}</span>
      </div>

      <p v-if="gridError" class="status error">{{ gridError }}</p>
      <p v-else-if="!loaded" class="status">{{ t('agentTanks.loading') }}</p>
      <p v-else-if="!sorted.length" class="status">{{ t('agentTanks.no_match') }}</p>
      <div v-else class="grid">
        <div
          v-for="tc in sorted" :key="tc.id"
          class="tank-card"
          :class="{ premium: tc.is_premium }"
          @click="openDetail(tc.id)"
        >
          <img class="tc-img" loading="lazy" :src="tankImageUrl(tc.id)" alt="">
          <div class="tc-body">
            <div class="tc-name" :title="tc.name">{{ tc.name }}</div>
            <div class="tc-meta">
              <span class="pill tier">T{{ tc.tier }}</span>
              <span class="pill nat">{{ NATION_LABEL[tc.nation] || tc.nation }}</span>
              <span class="pill" :class="TYPE_CLS[tc.type] || 't-unknown'">{{ TYPE_LABEL[tc.type] || tc.type }}</span>
            </div>
            <div class="tc-stats">
              <div><i>HP</i>{{ tc.hp ?? '-' }}</div>
              <div><i>{{ t('agentTanks.pen') }}</i>{{ tc.pen_max ?? '-' }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.agent-tanks { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.search { flex: 1; min-width: 200px; max-width: 340px; }
.count { color: var(--muted, #9aa4b2); font-size: 0.85em; }
.status.error { color: var(--danger, #e0665b); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
.tank-card {
  background: var(--panel, #1a2029); border: 1px solid var(--line, #2a3441); border-radius: 10px;
  overflow: hidden; cursor: pointer; transition: transform .12s ease, border-color .12s ease;
}
.tank-card:hover { transform: translateY(-3px); border-color: var(--accent, #6ea8fe); }
.tank-card.premium { border-color: rgba(255, 207, 92, 0.45); }
.tank-card .tc-img { width: 100%; height: 112px; object-fit: contain; background: linear-gradient(180deg, #202836, #171d26); display: block; padding: 6px; }
.tank-card .tc-body { padding: 8px 10px 10px; }
.tank-card .tc-name { font-size: 0.88em; font-weight: 700; line-height: 1.3; max-height: 2.6em; overflow: hidden; }
.tank-card .tc-meta { display: flex; justify-content: space-between; align-items: center; gap: 4px; margin-top: 6px; font-size: 0.74em; flex-wrap: wrap; }
.tank-card .tc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 7px; padding-top: 7px; border-top: 1px dashed var(--line, #2a3441); }
.tank-card .tc-stats > div { text-align: center; font-size: 0.74em; font-weight: 800; }
.tank-card .tc-stats i { display: block; font-style: normal; color: var(--muted, #9aa4b2); font-weight: 600; font-size: 0.88em; }
.dim { color: var(--muted, #9aa4b2); }
.muted { color: var(--muted, #9aa4b2); }
.small { font-size: 11px; }
.pill { border-radius: 999px; padding: 1px 8px; font-weight: 700; }
.pill.tier { background: rgba(255, 207, 92, 0.14); color: #ffcf5c; }
.pill.nat { background: rgba(95, 191, 122, 0.14); color: #5fbf7a; }
.pill.gold { background: rgba(255, 207, 92, 0.18); color: #ffd970; }
.pill.t-light { background: rgba(95, 191, 122, 0.16); color: #5fbf7a; }
.pill.t-medium { background: rgba(255, 207, 92, 0.14); color: #ffcf5c; }
.pill.t-heavy { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
.pill.t-td { background: rgba(95, 168, 232, 0.16); color: #5fa8e8; }
.pill.t-unknown { background: rgba(154, 164, 178, 0.18); color: #9aa4b2; }
.pill.shell { background: rgba(110, 168, 254, 0.14); color: #6ea8fe; font-size: 10px; }
.pill.shell.gold { background: rgba(255, 207, 92, 0.16); color: #ffcf5c; }
/* ---------- 详情态 ---------- */
.back { display: inline-block; align-self: flex-start; color: var(--muted, #9aa4b2); background: var(--panel, #1a2029);
        border: 1px solid var(--line, #2a3441); border-radius: 6px; padding: 6px 14px; cursor: pointer;
        font-size: 0.9em; text-decoration: none; }
.back:hover { color: var(--fg, #dfe5ec); border-color: var(--accent, #6ea8fe); }
.d-head { display: flex; gap: 20px; padding: 18px; border: 1px solid var(--line, #2a3441); border-radius: 12px;
          background: linear-gradient(180deg, var(--panel, #1a2029), #171d26); align-items: center; }
.d-head img { width: 170px; height: 124px; object-fit: contain; background: linear-gradient(180deg, #202836, #171d26); border-radius: 12px; padding: 6px; }
.d-title h2 { margin: 0 0 8px; font-size: 1.6em; }
.badges { display: flex; gap: 6px; flex-wrap: wrap; }
.d-card { border: 1px solid var(--line, #2a3441); border-radius: 12px; padding: 12px 14px; background: var(--panel, #1a2029); }
.sec-title { font-weight: 700; color: var(--accent, #6ea8fe); margin-bottom: 10px; }
.cfg-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.open3d { background: var(--accent, #6ea8fe); color: #0b1017; font-weight: 700; padding: 8px 16px; border: none; border-radius: 8px; cursor: pointer; }
.armor-table { border-collapse: collapse; font-size: 0.9em; max-width: 560px; width: 100%; }
.armor-table th, .armor-table td { border: 1px solid var(--line, #2a3441); padding: 6px 12px; text-align: center; }
.armor-table th { color: var(--muted, #9aa4b2); font-weight: 600; }
.armor-table .hot { font-weight: 800; }
.shell-table { border-collapse: collapse; font-size: 0.88em; width: 100%; }
.shell-table th { text-align: left; color: var(--muted, #9aa4b2); font-weight: 600; padding: 4px 6px; }
.shell-table td { padding: 4px 6px; border-top: 1px dashed var(--line, #2a3441); }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.stat-box { border: 1px solid var(--line, #2a3441); border-radius: 8px; padding: 8px 10px; }
.stat-box .lbl { font-size: 0.72em; color: var(--muted, #9aa4b2); }
.stat-box .val { font-size: 1.05em; font-weight: 800; }
@media (max-width: 640px) { .hide-sm { display: none; } .d-head { flex-direction: column; } }
button, select, input { background: #1d242e; color: var(--fg, #dfe5ec); border: 1px solid var(--line, #2a3441); padding: 4px 10px; border-radius: 6px; }
</style>
