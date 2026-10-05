<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TournamentStandings } from '../api/tournament-points.js'
const props = defineProps<{ standings: TournamentStandings }>()
const { locale, t } = useI18n()
const number = computed(() => new Intl.NumberFormat(locale.value))
const rounds = computed(() => Array.from({ length: props.standings.event.roundCount }, (_, i) => i + 1))
const days = computed(() => Array.from({ length: props.standings.event.daysPerRound }, (_, i) => i + 1))
const points = (value: number | null | undefined) => value == null ? '—' : number.value.format(value)
const dayLabel = (day: number) => {
  const label = props.standings.event.dayLabels[day - 1]
  return !label || /^Day \d+$/.test(label) ? t('tournament.day', { number: day }) : label
}
</script>
<template>
  <div class="tournament-table-wrap" tabindex="0" :aria-label="$t('tournament.title')">
    <table class="tournament-table" data-testid="tournament-table">
      <caption class="tournament-muted">{{ standings.event.year }} · {{ $t('tournament.regions.' + standings.event.region) }} · {{ $t('tournament.seasons.' + standings.event.season) }}</caption>
      <thead><tr>
        <th scope="col">{{ $t('tournament.rank') }}</th><th class="clan" scope="col">{{ $t('tournament.clan') }}</th><th scope="col">{{ $t('tournament.total') }}</th>
        <template v-for="round in rounds" :key="round">
          <th v-for="day in days" :key="day" scope="col">{{ $t('tournament.round', { number: round }) }} · {{ dayLabel(day) }}</th>
          <th scope="col" class="round-total">{{ $t('tournament.roundTotal', { number: round }) }}</th>
        </template>
      </tr></thead>
      <tbody>
        <tr v-for="row in standings.rows" :key="row.clanTag">
          <td>{{ row.rank }}</td><th scope="row" class="clan">{{ row.clanTag }}</th><td>{{ points(row.totalPoints) }}</td>
          <template v-for="round in rounds" :key="round">
            <td v-for="day in days" :key="day">{{ points(row.rounds.find(value => value.roundNumber === round)?.days.find(value => value.dayNumber === day)?.points) }}</td>
            <td class="round-total">{{ points(row.rounds.find(value => value.roundNumber === round)?.totalPoints) }}</td>
          </template>
        </tr>
        <tr v-if="!standings.rows.length"><td :colspan="3 + rounds.length * (days.length + 1)">{{ $t('tournament.empty') }}</td></tr>
      </tbody>
    </table>
  </div>
</template>
