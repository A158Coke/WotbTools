<script setup>
/**
 * Agent 坦克百科（?view=agent-tankopedia）：735 辆全景卡（tank_cache.json 静态面 /
 * /api/tanks 同源回退）+ 模糊搜索/筛选/排序 + 详情面板（装甲六面/弹种/机动/俯仰）。
 * 卡片动作 → 3D 装甲查看器（?view=agent-armor&tank={id}）。
 * 数据面：scene/agentData.js（契约 §13 静态资产面优先，服务端回退）。
 */
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchTankEncyclopedia, tankImageUrl } from '../scene/agentData.js'
import { tankFuzzyScore, TYPE_LABEL, TYPE_CLS, NATION_LABEL, normType, shellLabel, isPremiumShell } from '../scene/tankMeta.js'

const { t } = useI18n()

// 模块级缓存（ref 保持响应性）：重复进入视图不重新拉取
const cache = ref({})
const loaded = ref(false)
const gridError = ref('')

const q = ref('')
const tier = ref('')
const nation = ref('')
const type = ref('')
const sort = ref('name')
const detail = ref(null)

// tank_cache.json {id: info} → 卡片行（派生 pen_max/armor_front/armor_turret 摘要列）
const tanks = computed(() =>
  Object.entries(cache.value).map(([id, v]) => ({
    id: Number(id),
    name: v.name || '',
    tier: v.tier ?? 0,
    nation: v.nation || 'unknown',
    type: v.type || 'unknown',
    is_premium: !!v.is_premium,
    hp: v.hp ?? null,
    armor_front: v.armor?.hull_front ?? null,
    armor_turret: v.armor?.turret_front ?? null,
    pen_max: Array.isArray(v.shells) ? Math.max(0, ...v.shells.map((s) => s.penetration || 0)) || null : null,
    raw: v,
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
  // 模糊匹配 + 按得分降序（精确/前缀命中排最前），同分按名称
  return base
    .map((tc) => ({ tc, s: tankFuzzyScore(tc.name, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.tc.name || '').localeCompare(b.tc.name || ''))
    .map((x) => x.tc)
})

// 排序：默认名称；数值列 null 沉底
const sorted = computed(() => {
  const byNum = (key) => (a, b) => (b[key] ?? -1) - (a[key] ?? -1) || (a.name || '').localeCompare(b.name || '')
  const cmp = {
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    tier: (a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (a.name || '').localeCompare(b.name || ''),
    hp: byNum('hp'),
    armor: byNum('armor_front'),
    pen: byNum('pen_max'),
  }[sort.value] || ((a, b) => (a.name || '').localeCompare(b.name || ''))
  return filtered.value.slice().sort(cmp)
})

function openDetail(tc) {
  detail.value = tc
}

function openArmor(tc) {
  window.open(`/?view=agent-armor&tank=${tc.id}`, '_blank')
}

onMounted(async () => {
  gridError.value = ''
  try {
    const data = await fetchTankEncyclopedia()
    // 服务端 /api/tanks 回退返回数组 → 归一成 {id: info}
    cache.value = Array.isArray(data)
      ? Object.fromEntries(data.map((tc) => [String(tc.id), tc]))
      : data
    loaded.value = true
  } catch (e) {
    console.error('agent tankopedia load failed:', e)
    gridError.value = (t('agentTanks.error_load') || '加载失败') + ': ' + (e?.message || e)
  }
})
</script>

<template>
  <section class="agent-tanks">
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
        <option value="armor">{{ t('agentTanks.sort_armor') }}</option>
        <option value="pen">{{ t('agentTanks.sort_pen') }}</option>
      </select>
      <span class="count">{{ gridError ? '' : `${sorted.length} / ${tanks.length}` }}</span>
    </div>

    <p v-if="gridError" class="status error">{{ gridError }}</p>
    <p v-else-if="!loaded" class="status">{{ t('agentTanks.loading') }}</p>
    <p v-else-if="!sorted.length" class="status">{{ t('agentTanks.no_match') }}</p>
    <div v-else class="grid">
      <div
        v-for="tc in sorted"
        :key="tc.id"
        class="tank-card"
        :class="{ premium: tc.is_premium }"
        @click="openDetail(tc)"
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
            <div><i>{{ t('agentTanks.armor') }}</i>{{ tc.armor_front ?? '-' }}<span class="dim">/</span>{{ tc.armor_turret ?? '-' }}</div>
            <div><i>{{ t('agentTanks.pen') }}</i>{{ tc.pen_max ?? '-' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情面板（点卡片展开）：装甲六面 / 弹种 / 机动 / 火控 + 3D 装甲查看器入口 -->
    <div v-if="detail" class="detail-backdrop" @click.self="detail = null">
      <div class="detail">
        <header>
          <h3>{{ detail.name }} <span class="pill tier">T{{ detail.tier }}</span></h3>
          <button class="btn" @click="detail = null">×</button>
        </header>
        <div class="detail-grid">
          <div class="box">
            <h4>{{ t('agentTanks.armor') }}</h4>
            <div class="ar-row" v-for="k in ['hull_front', 'hull_sides', 'hull_rear', 'turret_front', 'turret_sides', 'turret_rear']" :key="k">
              <span>{{ t('agentTanks.' + k) }}</span><b>{{ detail.raw.armor?.[k] ?? '-' }}</b>
            </div>
          </div>
          <div class="box">
            <h4>{{ t('agentTanks.mobility') }}</h4>
            <div class="ar-row"><span>{{ t('agentTanks.hp') }}</span><b>{{ detail.raw.hp ?? '-' }}</b></div>
            <div class="ar-row"><span>{{ t('agentTanks.speed_fwd') }}</span><b>{{ detail.raw.speed_forward ?? '-' }} km/h</b></div>
            <div class="ar-row"><span>{{ t('agentTanks.speed_rev') }}</span><b>{{ detail.raw.speed_reverse ?? '-' }} km/h</b></div>
            <div class="ar-row"><span>{{ t('agentTanks.view_range') }}</span><b>{{ detail.raw.view_range ?? '-' }} m</b></div>
            <div class="ar-row"><span>{{ t('agentTanks.hull_traverse') }}</span><b>{{ detail.raw.hull_traverse ?? '-' }} °/s</b></div>
            <div class="ar-row"><span>{{ t('agentTanks.turret_traverse') }}</span><b>{{ detail.raw.turret_traverse_speed ?? '-' }} °/s</b></div>
            <div class="ar-row"><span>{{ t('agentTanks.gun_dep_ele') }}</span><b>{{ detail.raw.gun_depression ?? '-' }}° / {{ detail.raw.gun_elevation ?? '-' }}°</b></div>
          </div>
          <div class="box">
            <h4>{{ t('agentTanks.shells') }}</h4>
            <table>
              <thead><tr><th>{{ t('agentTanks.shell') }}</th><th>{{ t('agentTanks.pen') }}</th><th>{{ t('agentTanks.dmg') }}</th></tr></thead>
              <tbody>
                <tr v-for="(s, i) in detail.raw.shells || []" :key="i">
                  <td><span class="pill shell" :class="{ gold: isPremiumShell(s) }">{{ shellLabel(s) || normType(s.type) }}</span></td>
                  <td>{{ s.penetration ?? '-' }}</td>
                  <td>{{ s.damage ?? '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <footer>
          <button class="btn primary" @click="openArmor(detail)">{{ t('agentTanks.open_armor') }}</button>
        </footer>
      </div>
    </div>
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
.tank-card .tc-stats { display: grid; grid-template-columns: 1fr 1.25fr 1fr; gap: 4px; margin-top: 7px; padding-top: 7px; border-top: 1px dashed var(--line, #2a3441); }
.tank-card .tc-stats > div { text-align: center; font-size: 0.74em; font-weight: 800; }
.tank-card .tc-stats i { display: block; font-style: normal; color: var(--muted, #9aa4b2); font-weight: 600; font-size: 0.88em; }
.dim { color: var(--muted, #9aa4b2); }
.pill { border-radius: 999px; padding: 1px 8px; font-weight: 700; }
.pill.tier { background: rgba(255, 207, 92, 0.14); color: #ffcf5c; }
.pill.nat { background: rgba(95, 191, 122, 0.14); color: #5fbf7a; }
.pill.t-light { background: rgba(95, 191, 122, 0.16); color: #5fbf7a; }
.pill.t-medium { background: rgba(255, 207, 92, 0.14); color: #ffcf5c; }
.pill.t-heavy { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
.pill.t-td { background: rgba(95, 168, 232, 0.16); color: #5fa8e8; }
.pill.t-unknown { background: rgba(154, 164, 178, 0.18); color: #9aa4b2; }
.pill.shell { background: rgba(110, 168, 254, 0.14); color: #6ea8fe; font-size: 10px; }
.pill.shell.gold { background: rgba(255, 207, 92, 0.16); color: #ffcf5c; }
.detail-backdrop { position: fixed; inset: 0; background: rgba(6, 10, 16, 0.66); z-index: 60; display: flex; align-items: center; justify-content: center; }
.detail { background: var(--panel, #1a2029); border: 1px solid var(--line, #2a3441); border-radius: 12px; width: min(860px, 94vw); max-height: 88vh; overflow-y: auto; padding: 14px 16px; }
.detail header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.detail h3 { margin: 0; font-size: 1.1em; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.box { border: 1px solid var(--line, #2a3441); border-radius: 8px; padding: 10px; }
.box h4 { margin: 0 0 8px; font-size: 0.9em; color: var(--accent, #6ea8fe); }
.ar-row { display: flex; justify-content: space-between; margin: 3px 0; font-size: 0.85em; }
.ar-row span { color: var(--muted, #9aa4b2); }
.box table { width: 100%; border-collapse: collapse; font-size: 0.82em; }
.box th { text-align: left; color: var(--muted, #9aa4b2); font-weight: 600; padding: 2px 4px; }
.box td { padding: 2px 4px; border-top: 1px dashed var(--line, #2a3441); }
.detail footer { margin-top: 12px; display: flex; justify-content: flex-end; }
button, select, input { background: #1d242e; color: var(--fg, #dfe5ec); border: 1px solid var(--line, #2a3441); padding: 4px 10px; border-radius: 6px; }
.btn.primary { background: var(--accent, #6ea8fe); color: #0b1017; font-weight: 700; }
</style>
