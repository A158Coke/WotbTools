<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TournamentStandings } from '../api/tournament-points.js'
import { localizedDayLabel, projectTournamentPoints } from '../utils/tournamentPointsExport.js'
const props = withDefaults(defineProps<{ standings: TournamentStandings; publicView?: boolean; grouped?: boolean }>(), { publicView: false })
const { locale, t } = useI18n()
const groupedView = computed(() => props.publicView || props.grouped)
const number = computed(() => new Intl.NumberFormat(locale.value))
const table = computed(() => projectTournamentPoints(props.standings, locale.value, t))
const clanCount = computed(() => props.standings.rows.length)
const publishedDays = computed(() => props.standings.days.filter(day => day.published).length)
const display = (value: number | string | null) => value == null ? '—' : typeof value === 'number' ? number.value.format(value) : value
</script>
<template>
  <div class="tournament-board" :class="{ 'tournament-board-public': publicView, 'tournament-board-grouped': groupedView }">
    <header v-if="publicView" class="tournament-board-heading" data-testid="tournament-public-summary">
      <h2><span class="tournament-board-year">{{ standings.event.year }}</span>{{ table.identity.slice(String(standings.event.year).length) }}</h2>
      <dl class="tournament-board-stats">
        <div class="tournament-stat"><dt>{{ $t('tournament.participatingClans') }}</dt><dd data-testid="tournament-clan-count">{{ number.format(clanCount) }}</dd></div>
        <div class="tournament-stat"><dt>{{ $t('tournament.publishedMatchDays') }}</dt><dd data-testid="tournament-published-days">{{ number.format(publishedDays) }} <span>/ {{ number.format(standings.event.roundCount * standings.event.daysPerRound) }}</span></dd></div>
      </dl>
    </header>
    <div class="tournament-table-wrap" tabindex="0" :aria-label="$t('tournament.title')">
      <table class="tournament-table" data-testid="tournament-table" :aria-label="publicView ? table.identity : undefined">
        <caption v-if="!publicView" class="tournament-muted">{{ table.identity }}</caption>
        <template v-if="groupedView"><colgroup span="3" /><colgroup v-for="round in standings.event.roundCount" :key="round" :span="standings.event.daysPerRound + 1" /></template>
        <thead v-if="groupedView">
          <tr class="tournament-round-headings">
            <th v-for="column in table.columns.slice(0, 3)" :key="column.key" scope="col" rowspan="2" :class="column.kind">{{ column.label }}</th>
            <th v-for="round in standings.event.roundCount" :key="round" scope="colgroup" :colspan="standings.event.daysPerRound + 1" class="tournament-round-heading">{{ $t('tournament.round', { number: round }) }}</th>
          </tr>
          <tr class="tournament-day-headings">
            <template v-for="round in standings.event.roundCount" :key="round">
              <th v-for="day in standings.event.daysPerRound" :key="day" scope="col" class="day">{{ localizedDayLabel(standings.event.dayLabels[day - 1], day, t) }}</th>
              <th scope="col" class="round-total">{{ $t('tournament.roundTotal', { number: round }) }}</th>
            </template>
          </tr>
        </thead>
        <thead v-else><tr>
          <th v-for="column in table.columns" :key="column.key" scope="col" :class="column.kind">{{ column.label }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="row in table.rows" :key="row.clanTag">
            <template v-for="(column, index) in table.columns" :key="column.key">
              <th v-if="column.kind === 'clan'" scope="row" class="clan">{{ display(row.cells[index]) }}</th>
              <td v-else :class="column.kind">{{ display(row.cells[index]) }}</td>
            </template>
          </tr>
          <tr v-if="!table.rows.length"><td :colspan="table.columns.length">{{ $t('tournament.empty') }}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
