<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TournamentStandings } from '../api/tournament-points.js'
import { projectTournamentPoints } from '../utils/tournamentPointsExport.js'
const props = defineProps<{ standings: TournamentStandings }>()
const { locale, t } = useI18n()
const number = computed(() => new Intl.NumberFormat(locale.value))
const table = computed(() => projectTournamentPoints(props.standings, locale.value, t))
const display = (value: number | string | null) => value == null ? '—' : typeof value === 'number' ? number.value.format(value) : value
</script>
<template>
  <div class="tournament-table-wrap" tabindex="0" :aria-label="$t('tournament.title')">
    <table class="tournament-table" data-testid="tournament-table">
      <caption class="tournament-muted">{{ table.identity }}</caption>
      <thead><tr>
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
</template>
