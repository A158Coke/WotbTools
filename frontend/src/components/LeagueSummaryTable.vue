<script setup>
import { useI18n } from 'vue-i18n'

const props = defineProps({
  title: String,
  /** 'player' | 'team' */
  type: String,
  rows: { type: Array, default: () => [] },
  /** ColumnDef 列表（key + num） */
  columns: { type: Array, default: () => [] },
  /** 批次战队 identity 覆盖 {teamKey: name}（PR #123 Blocker 2：不得反向改单场 {arenaId:team}）。 */
  teamNames: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update-summary-team-name'])
const { t } = useI18n()

const DIM_KEYS = ['league_damage_score', 'league_assist_score', 'league_kill_score',
  'league_exchange_score', 'league_blocked_score', 'league_survival_score',
  'league_shooting_score', 'league_objective_score']

function label(key) {
  return t('league.summary.' + key)
}

function cellValue(row, key) {
  if (key === 'team_name') return ''
  if (key === 'nickname') return row.nickname
  if (key === 'clan') return row.clan
  if (key === 'battles') return row.battles
  if (key === 'league_rating') return row.ratingMedian
  if (key === 'mvp_count') return row.mvpCount
  if (key === 'wins') return row.wins
  if (key === 'damage_total') return row.damageTotal
  if (key === 'assist_total') return row.assistTotal
  if (key === 'kills_total') return row.killsTotal
  const dimIndex = DIM_KEYS.indexOf(key)
  if (dimIndex >= 0) return (row.dimensionMedians || [])[dimIndex]
  return row[key]
}

function displayValue(value) {
  if (value == null || value === '') return '--'
  const n = Number(value)
  if (Number.isFinite(n)) return String(Math.round(n * 10) / 10)
  return String(value)
}

function ratingText(value) {
  const v = Number(value) || 0
  const pct = Math.round(1000 * v / 1000) / 10
  return Math.round(v) + ' · ' + pct + '%'
}

function teamDisplayName(row) {
  const override = props.teamNames ? props.teamNames[row.teamKey] : undefined
  if (override) return override
  return row.autoName || t('league.team_name_pending')
}

/** 批次战队名称编辑：只改 {teamKey} → 名，绝不批量覆盖所有 {arenaId:team}（PR #123 Blocker 2）。 */
function onTeamNameInput(row, event) {
  emit('update-summary-team-name', { teamKey: row.teamKey, name: event.target.value })
}
</script>

<template>
  <div class="league-summary">
    <div class="league-summary-head">
      <span class="league-summary-title">{{ title }}</span>
      <span class="league-summary-note">{{ $t('league.summary.battles_note') }}</span>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th v-for="c in columns" :key="c.key">{{ label(c.key) }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="i">
            <td v-for="c in columns" :key="c.key">
              <template v-if="c.key === 'team_name'">
                <input class="team-name-input" :value="teamDisplayName(row)"
                       :placeholder="t('league.team_name_pending')"
                       :title="t('league.edit_hint')"
                       @input="onTeamNameInput(row, $event)" />
              </template>
              <template v-else-if="c.key === 'league_rating'">{{ ratingText(cellValue(row, c.key)) }}</template>
              <template v-else>{{ displayValue(cellValue(row, c.key)) }}</template>
            </td>
          </tr>
          <!-- League Rating 空态（plan §12）：明确 neutral 文案，而不是只有 "--" -->
          <tr v-if="!rows.length"><td :colspan="Math.max(columns.length, 1)" class="league-summary-empty">{{ $t('league.summary.no_rateable') }}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="league-summary-note">{{ $t('league.summary.no_ranking_note') }}</p>
  </div>
</template>

<style scoped>
.league-summary { margin-bottom: 16px; }
.league-summary-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.league-summary-title { font-size: .9rem; font-weight: 800; color: var(--text-heading); }
.league-summary-note { font-size: .72rem; color: var(--text-sub); }
.team-name-input {
  min-width: 120px; padding: 3px 8px;
  border: 1px dashed var(--border); border-radius: 5px;
  background: transparent; color: var(--text-heading); font-size: .82rem; font-weight: 600; font-family: inherit;
}
.team-name-input:focus { border-color: var(--accent); outline: none; }
.league-summary-empty { text-align: center; color: var(--text-sub); }
</style>
