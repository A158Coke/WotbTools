<script setup>
// 汇总视图顶部的系列赛概览（审计 BZ-06）：两支稳定战队时显示比分，其后是逐场结果条。
// 逐场条目可点击，跳到该场的单场视图。视图模型来自 utils/replaySeries.js。
import { useI18n } from 'vue-i18n'
import { fmtDuration, mapLabel } from '../utils/helpers.js'
import { battleWinnerText } from '../utils/replaySeries.js'

defineProps({
  /** buildSeriesOverview() 的返回值。 */
  series: { type: Object, required: true },
})
const emit = defineEmits(['select-battle'])
const { t, locale } = useI18n()

function teamName(team) {
  return team.name || t('league.team_name_pending')
}
</script>

<template>
  <section class="series" data-testid="series-overview" :aria-label="t('workspace.series_title')">
    <div v-if="series.teams" class="series-score" data-testid="series-score">
      <span class="series-team">{{ teamName(series.teams[0]) }}</span>
      <span class="series-digits">
        <span>{{ series.teams[0].wins }}</span>
        <span class="series-colon" aria-hidden="true">:</span>
        <span>{{ series.teams[1].wins }}</span>
      </span>
      <span class="series-team">{{ teamName(series.teams[1]) }}</span>
    </div>
    <p v-if="series.unresolved" class="series-note" data-testid="series-unresolved">
      {{ t('workspace.series_unresolved', { count: series.unresolved }) }}
    </p>

    <h3 class="series-heading">{{ t('workspace.series_results') }}</h3>
    <ol class="series-strip">
      <li v-for="battle in series.battles" :key="battle.sourceId">
        <button
          type="button"
          class="series-battle"
          :class="{
            'is-lead': series.teams && battle.winnerKey === series.teams[0].key,
            'is-trail': series.teams && battle.winnerKey === series.teams[1].key,
          }"
          data-testid="series-battle"
          :data-source-id="battle.sourceId"
          @click="emit('select-battle', battle.sourceId)"
        >
          <span class="series-index">{{ t('workspace.battle_n', { n: battle.index + 1 }) }}</span>
          <span class="series-map">{{ battle.mapName ? mapLabel(battle.mapName, locale) : '--' }}</span>
          <span class="series-winner">{{ battleWinnerText(battle, t) }}</span>
          <span v-if="battle.durationS != null" class="series-duration">{{ fmtDuration(battle.durationS, t) }}</span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.series {
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}

.series-score {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
}

.series-team { overflow: hidden; color: var(--color-text-primary); font: var(--type-h3); text-overflow: ellipsis; white-space: nowrap; }
.series-team:first-child { text-align: end; }
.series-digits { display: inline-flex; gap: var(--space-2); color: var(--color-text-primary); font: var(--type-display); font-variant-numeric: tabular-nums; }
.series-colon { color: var(--color-text-tertiary); }
.series-note { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); text-align: center; }

.series-heading { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }

.series-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.series-battle {
  display: grid;
  gap: var(--space-0);
  width: 100%;
  min-height: var(--control-h-lg);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-inline-start: 3px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
}

.series-battle.is-lead { border-inline-start-color: var(--color-accent); }
.series-battle.is-trail { border-inline-start-color: var(--color-info); }
.series-battle:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.series-index,
.series-duration { color: var(--color-text-secondary); font: var(--type-caption); }
.series-map { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.series-winner { font: var(--type-caption); }

@media (hover: hover) {
  .series-battle:hover { background: var(--color-surface-3); }
}

@media (width < 768px) {
  .series { padding: var(--space-3); }
  .series-digits { font: var(--type-h1); }
  .series-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
