<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { fmtDuration, mapLabel } from '../utils/helpers.js'
import { replayValueLabel } from '../utils/display.js'
import { stableSortRows } from '../utils/tableSort.js'

const { locale, t, te } = useI18n()
const LOCALIZED_VALUE_KEYS = new Set(['tank_type', 'tank_nation', 'potential_damage_detail'])
// 单场表现派生列：HP unknown 时为 null（显示 "--"，不冒充 0）；有值时统一百分比展示
const PERCENT_KEYS = new Set(['contribution', 'kast', 'impact'])
const props = defineProps({
  battle: Object,
  shownCols: Array,
  /** League 模式：resp.league.columns（key/max/fixed/group 元数据）。 */
  leagueColumns: { type: Array, default: () => [] },
  /** League 模式：resp.league 单场元数据（team ratings / MVP / 队内最佳）。 */
  league: { type: Object, default: null },
  /** 战队名称覆盖：{arenaId:team: name}（仅当前页面内存，plan §12）。 */
  teamNames: { type: Object, default: () => ({}) },
  /**
   * 本表是否当前可见（父组件拥有真实 activeTab；BattleTable 不通过 DOM 猜 visibility）。
   * active=false（v-show hidden）时禁止测量：hidden DOM width=0 不得覆盖有效 sticky offset。
   */
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['update-team-name', 'select-player'])

const isLeague = computed(() => !!props.league)
const leagueMaxByKey = computed(() =>
  Object.fromEntries((props.leagueColumns || []).map(c => [c.key, c.max])))

function percentCell(value) {
  if (value == null || value === '') return '--'
  return (Math.round(value * 10) / 10) + '%'
}

const sortKey = ref('')
const sortReverse = ref(false)

/** 战队名称按用户最终看到的名（override → autoName）排序（plan §11.8），不按隐藏 teamKey。 */
function teamNameValue(row) {
  const teamNumber = row.team
  const key = props.battle.arenaId + ':' + teamNumber
  const override = props.teamNames ? props.teamNames[key] : undefined
  if (override) return override
  return teamNumber === 1 ? props.league?.team1?.autoName : props.league?.team2?.autoName
}

const sorted = computed(() => {
  if (!sortKey.value) return props.battle.players
  const col = props.shownCols.find(c => c.key === sortKey.value)
  const isTeamName = sortKey.value === 'team_name'
  const valueGetter = isTeamName ? teamNameValue : undefined
  return stableSortRows(props.battle.players, {
    key: sortKey.value,
    direction: sortReverse.value ? -1 : 1,
    num: isTeamName ? false : !!col?.num,
    locale: locale.value,
    valueGetter,
    // accountId 兜底保持稳定（同分不跳行）
    tiebreakGetter: row => row.cells?.account_id,
  })
})

function sortBy(col) {
  if (sortKey.value === col.key) sortReverse.value = !sortReverse.value
  else { sortKey.value = col.key; sortReverse.value = false }
}

function arrow(key) {
  return sortKey.value === key ? (sortReverse.value ? ' ▼' : ' ▲') : ''
}

function survivalClass(value) {
  if (value === 'SURVIVED') return 'alive'
  if (value === 'DESTROYED') return 'dead'
  return ''
}

function survivalLabel(value) {
  if (value === 'SURVIVED') return t('survived.alive')
  if (value === 'DESTROYED') return t('survived.dead')
  return value ?? '--'
}

// ---- League Rating 概览 ----

function round1(v) {
  const n = Number(v) || 0
  return Math.round(n * 10) / 10
}

function ratingText(rating, max) {
  const v = Number(rating) || 0
  const m = Number(max) || 1000
  const pct = m > 0 ? Math.round(1000 * v / m) / 10 : 0
  return Math.round(v) + ' · ' + pct + '%'
}

function teamRatingText(team) {
  if (!team) return '--'
  return ratingText(team.teamRating, 1000)
}

function teamName(teamNumber) {
  const key = props.battle.arenaId + ':' + teamNumber
  const override = props.teamNames ? props.teamNames[key] : undefined
  if (override) return override
  const auto = teamNumber === 1 ? props.league?.team1?.autoName : props.league?.team2?.autoName
  if (auto) return auto
  return ''
}

function onTeamNameInput(teamNumber, event) {
  emit('update-team-name', { arenaId: props.battle.arenaId, team: teamNumber, name: event.target.value })
}

/** 点击玩家行 → 打开选手 Drawer（plan §8.1：CW 单场 BattleTable 支持；selection = accountId §8.7）。 */
function onRowClick(row) {
  if (!isLeague.value) return
  emit('select-player', {
    scope: 'battle',
    accountId: Number(row.cells.account_id),
    arenaId: props.battle.arenaId,
  })
}

// ---- Rating 单元格（总分「927 · 92.7%」；维度「342 / 400 · 85.5%」） ----

function ratingCellText(value, key) {
  const v = Number(value) || 0
  const max = Number(leagueMaxByKey.value[key]) || 0
  if (max <= 0) return String(v)
  const pct = Math.round(1000 * v / max) / 10
  // 总 Rating 显示「927 · 92.7%」；维度显示「342 / 400 · 85.5%」
  if (key === 'league_rating') return Math.round(v) + ' · ' + pct + '%'
  return Math.round(v) + ' / ' + max + ' · ' + pct + '%'
}

function rowFlags(row) {
  if (!isLeague.value) return { mvp: false, teamBest: false }
  const accountId = Number(row.cells.account_id) || 0
  const mvp = accountId === Number(props.league?.mvpAccountId)
  const teamBest = accountId === (row.team === 1
    ? Number(props.league?.team1BestAccountId)
    : Number(props.league?.team2BestAccountId))
  return { mvp, teamBest }
}

// ---- sticky 列（League 模式：玩家 + 总 Rating 固定，左偏移响应真实列宽） ----
// invariant：nickname.left = 0；league_rating.left = 真实可见 nickname 列宽（>0）。
// 禁止 hidden measurement（width<=0）覆盖有效 offset（plan §3.3/§3.4）。

const headerRefs = ref({})
const stickyLeft = ref({ nickname: 0, league_rating: null })

let stickyRaf = 0
let stickyObserver = null

// happy-dom / 老环境无 rAF 时回退 setTimeout(0)；组件内部不直接依赖全局 rAF 存在。
const nextFrame = typeof requestAnimationFrame === 'function'
  ? (cb) => requestAnimationFrame(cb)
  : (cb) => setTimeout(cb, 0)
const cancelFrame = typeof cancelAnimationFrame === 'function'
  ? (id) => cancelAnimationFrame(id)
  : (id) => clearTimeout(id)

function disconnectStickyObserver() {
  if (stickyObserver) {
    stickyObserver.disconnect()
    stickyObserver = null
  }
}

function connectStickyObserver() {
  disconnectStickyObserver()
  const nickEl = headerRefs.value['nickname']
  if (!nickEl || typeof ResizeObserver === 'undefined') return
  stickyObserver = new ResizeObserver(() => scheduleStickyMeasure())
  stickyObserver.observe(nickEl)
}

/** 读取真实可见 nickname 列宽；非有限或 <=0 视为 hidden（返回 0，不参与写入）。 */
function nicknameWidth() {
  const nickEl = headerRefs.value['nickname']
  if (!nickEl) return 0
  const width = nickEl.getBoundingClientRect().width
  return (Number.isFinite(width) && width > 0) ? width : 0
}

/**
 * 调度一次 sticky 测量：active=false 不测；nextTick + rAF 后读真实 layout；
 * width<=0（hidden）时保留已有有效 offset，绝不写入 0（plan §3.3/§3.4/Test E）。
 */
function scheduleStickyMeasure() {
  if (!isLeague.value || !props.active) return
  nextTick(() => {
    cancelFrame(stickyRaf)
    stickyRaf = nextFrame(() => {
      const width = nicknameWidth()
      if (width <= 0) return
      stickyLeft.value = { nickname: 0, league_rating: width }
    })
  })
}

// 表头 ref 改变（重挂载）→ 重连 observer（mount → observe / ref 改变 → reconnect）
watch(headerRefs, () => connectStickyObserver(), { deep: true })
// 列系统 / League 模式 / 排序箭头变化都可能改昵称列宽 → 重新调度测量（plan §3.6/§14）
watch(() => props.shownCols, scheduleStickyMeasure, { deep: true })
watch(isLeague, scheduleStickyMeasure)
watch([sortKey, sortReverse], scheduleStickyMeasure)
// hidden → visible：父组件切换 activeTab 后重新测量真实宽度（plan §3.3）
watch(() => props.active, (active) => {
  if (active) scheduleStickyMeasure()
})
onMounted(() => {
  connectStickyObserver()
  scheduleStickyMeasure()
  window.addEventListener('resize', scheduleStickyMeasure)
})
onBeforeUnmount(() => {
  disconnectStickyObserver()
  cancelFrame(stickyRaf)
  window.removeEventListener('resize', scheduleStickyMeasure)
})

const isStickyCol = key => isLeague.value && (key === 'nickname' || key === 'league_rating')
const colStyle = key => {
  if (!isStickyCol(key)) return {}
  if (key === 'nickname') return { left: '0px' }
  const v = stickyLeft.value[key]
  return v == null ? {} : { left: v + 'px' }
}
</script>

<template>
  <div>
    <div class="mcards">
      <div class="mc"><div class="k">{{ $t('metric.map') }}</div><div class="v">{{ mapLabel(battle.mapName, locale) }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.duration') }}</div><div class="v">{{ fmtDuration(battle.durationS, t) }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.winner') }}</div><div class="v">{{ battle.winnerTeam ? $t('team.' + battle.winnerTeam) : $t('team.unknown') }}</div></div>
      <div class="mc"><div class="k">{{ $t('metric.player_count') }}</div><div class="v">{{ battle.players.length }}</div></div>
    </div>

    <!-- League Rating 概览（训练赛/联赛专属；概览卡下方、玩家表上方） -->
    <div v-if="isLeague" class="league-overview">
      <div class="league-head">
        <span class="league-title">{{ $t('league.title') }}</span>
        <span class="league-sub">{{ $t('league.subtitle') }}</span>
      </div>
      <div class="league-teams">
        <div v-for="tn in [1, 2]" :key="tn" class="league-team"
             :class="battle.winnerTeam === tn ? 'league-win' : ''">
          <span class="league-team-tag">{{ $t('league.' + (tn === 1 ? 'team1' : 'team2')) }}</span>
          <input class="team-name-input" :value="teamName(tn)"
                 :placeholder="t('league.team_name_pending')"
                 :title="t('league.edit_hint')"
                 @input="onTeamNameInput(tn, $event)" />
          <span class="league-team-rating">{{ teamRatingText(tn === 1 ? league.team1 : league.team2) }}</span>
        </div>
      </div>
      <div class="league-mvp">
        <span class="lm-label">{{ $t('league.mvp') }}</span>
        <b class="lm-value">{{ league.mvpNickname || '--' }}</b>
        <span class="lm-label">{{ $t('league.team_best') }}</span>
        <b class="lm-value">{{ $t('league.team1') }}: {{ league.team1BestNickname || '--' }}</b>
        <b class="lm-value">{{ $t('league.team2') }}: {{ league.team2BestNickname || '--' }}</b>
      </div>
      <div class="league-note">{{ $t('league.points_note') }}</div>
    </div>

    <div class="tablewrap">
      <table :class="isLeague ? 'league-table' : ''">
        <thead><tr>
          <th v-for="c in shownCols" :key="c.key"
              :ref="(el) => { if (c.key === 'nickname' || c.key === 'league_rating') headerRefs[c.key] = el }"
              :class="{ 'sticky-col': isStickyCol(c.key) }" :style="colStyle(c.key)"
              @click="sortBy(c)"
              :title="c.key === 'survival_time' ? $t('player_labels.survival_time_tip')
                : (isLeague && leagueMaxByKey[c.key] > 0 ? $t('player_labels.' + c.key + '_tip') : undefined)">
            {{ $t('player_labels.' + c.key) }}{{ arrow(c.key) }}
          </th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, ri) in sorted" :key="ri"
              :class="[row.team === 1 ? 't1' : 't2', isLeague ? 'player-row' : '']"
              @click="onRowClick(row)">
            <td v-for="c in shownCols" :key="c.key"
                :class="{ 'sticky-col': isStickyCol(c.key), 'sticky-t1': isStickyCol(c.key) && row.team === 1, 'sticky-t2': isStickyCol(c.key) && row.team === 2 }"
                :style="colStyle(c.key)">
              <span v-if="c.key === 'survived_label'" :class="survivalClass(row.cells[c.key])">{{ survivalLabel(row.cells[c.key]) }}</span>
              <span v-else-if="c.key === 'survival_time'">{{ fmtDuration(row.cells[c.key], t) }}</span>
              <span v-else-if="LOCALIZED_VALUE_KEYS.has(c.key)">{{ replayValueLabel(t, te, row.cells[c.key]) }}</span>
              <span v-else-if="PERCENT_KEYS.has(c.key)">{{ percentCell(row.cells[c.key]) }}</span>
              <span v-else-if="c.key === 'league_rating'" class="league-rating-cell">
                {{ ratingCellText(row.cells[c.key], c.key) }}
                <span v-if="rowFlags(row).mvp" class="mvp-badge" :title="$t('league.mvp')">MVP</span>
                <span v-else-if="rowFlags(row).teamBest" class="team-best-badge" :title="$t('league.team_best')">★</span>
              </span>
              <span v-else-if="isLeague && leagueMaxByKey[c.key] > 0">{{ ratingCellText(row.cells[c.key], c.key) }}</span>
              <span v-else>{{ row.cells[c.key] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="scroll-hint">{{ $t('result.scroll_hint') }}</p>
  </div>
</template>

<style scoped>
.league-overview {
  margin-bottom: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--surface-shadow);
}
.league-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.league-title { font-size: .95rem; font-weight: 800; color: var(--text-heading); }
.league-sub { font-size: .75rem; color: var(--text-sub); }
.league-teams { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; margin-bottom: 8px; }
.league-team {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border: 1px solid var(--border-light); border-radius: 7px;
}
.league-team.league-win { border-color: var(--accent); background: var(--bg-blue-light); }
.league-team-tag { font-size: .72rem; font-weight: 700; color: var(--text-sub); white-space: nowrap; }
.team-name-input {
  flex: 1; min-width: 0; padding: 4px 8px;
  border: 1px dashed var(--border); border-radius: 5px;
  background: transparent; color: var(--text-heading); font-size: .85rem; font-weight: 600; font-family: inherit;
}
.team-name-input:focus { border-color: var(--accent); outline: none; }
.league-team-rating { font-size: .95rem; font-weight: 800; color: var(--accent-dark); font-variant-numeric: tabular-nums; white-space: nowrap; }
.league-mvp { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: .82rem; }
.lm-label { color: var(--text-sub); font-weight: 600; }
.lm-value { color: var(--text-heading); font-weight: 700; }
.league-note { margin-top: 6px; font-size: .72rem; color: var(--text-sub); }

/* League 表格：玩家 + 总 Rating sticky；其余列横向滚动。
   z-index 层级（plan §17）：tbody normal < tbody sticky(3) < thead normal(5) < thead sticky(7)。
   此处 scoped 特异性高于全局 showcase 规则，必须显式对齐全局层级——
   否则普通表头(5)画在 sticky 表头(3)之上，横向滚动时普通表头会覆盖固定玩家/Rating 列。 */
.league-table th.sticky-col, .league-table td.sticky-col {
  position: sticky;
}
.league-table td.sticky-col { z-index: 3; background: var(--bg-card); }
.league-table th.sticky-col { z-index: 7; background: var(--bg-card2); }
.league-table td.sticky-col.sticky-t1 { background: color-mix(in srgb, var(--bg-t1) 64%, var(--bg-card)); }
.league-table td.sticky-col.sticky-t2 { background: color-mix(in srgb, var(--bg-t2) 64%, var(--bg-card)); }
.league-table tr:hover td.sticky-col { background: var(--bg-list-hover); }

/* 玩家行点击（Drawer 打开，plan §13：header click 排序、row click 选人，互不触发） */
.league-table .player-row { cursor: pointer; }
.league-table tr.player-row:hover td { background: var(--bg-list-hover); }

/* Rating 单元格 + 徽标（固定尺寸避免列宽跳动） */
.league-rating-cell { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
.mvp-badge, .team-best-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; height: 17px; padding: 0 5px; border-radius: 9px;
  font-size: .65rem; font-weight: 800; line-height: 1;
}
.mvp-badge { background: var(--accent); color: var(--accent-text); }
.team-best-badge { background: var(--status-ok-bg); color: var(--status-ok-fg); }
</style>