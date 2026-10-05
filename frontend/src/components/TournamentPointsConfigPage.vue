<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useTournamentPointsConfig } from '../composables/useTournamentPointsConfig.js'
import { TOURNAMENT_REGIONS, TOURNAMENT_SEASONS } from '../api/tournament-points.js'
import { apiErrorLabel } from '../utils/display.js'
import PageHeader from './PageHeader.vue'
import Banner from './Banner.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import '../styles/tournament-points.css'
const { t, te } = useI18n()
const { events, eventId, config, form, round, ruleInputs, rule, ruleDays, busy, error, stale, notice, allowed, refresh, saveConfig, saveRules, removeEvent, newEvent } = useTournamentPointsConfig()
const naming = ref('DAY'), deleteOpen = ref(false)
watch(config, value => { naming.value = value?.event.dayLabels.slice(0, 2).every(label => /^Day \d+$/.test(label)) === false ? 'STAGE' : 'DAY' })
function chooseNaming() {
  form.value.dayLabels = Array.from({ length: form.value.daysPerRound }, (_, i) => naming.value === 'STAGE' && i < 2
    ? t(i === 0 ? 'tournament.groupStage' : 'tournament.finalStage') : `Day ${i + 1}`)
}
async function deleteConfirmed() { await removeEvent(); deleteOpen.value = false }
</script>
<template>
  <div class="tournament-page tournament-stack">
    <PageHeader :title="$t('tournament.configTitle')"><template #actions>
      <RouterLink :to="{ path: '/', query: { view: 'tournament-points-admin' } }">{{ $t('tournament.statistics') }}</RouterLink>
      <AppButton :disabled="busy" @click="refresh">{{ $t('tournament.refresh') }}</AppButton>
    </template></PageHeader>
    <Banner v-if="!allowed" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <template v-else>
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <Banner v-else-if="notice">{{ $t('tournament.' + notice) }}</Banner>
      <p v-if="busy" role="status">{{ $t('tournament.loading') }}</p>
      <TournamentEventSelect v-model="eventId" :events="events" :disabled="busy" />
      <AppButton :disabled="busy" @click="newEvent">{{ $t('tournament.createEvent') }}</AppButton>
      <form class="tournament-card" @submit.prevent="saveConfig">
        <h2>{{ $t('tournament.event') }}</h2>
        <p class="tournament-muted">{{ $t('tournament.identity') }}</p>
        <Banner v-if="config?.event.configLocked">{{ $t('tournament.structureLocked') }}</Banner>
        <div class="tournament-toolbar">
          <label class="tournament-field"><span>{{ $t('tournament.year') }}</span><input v-model.number="form.year" type="number" min="2000" max="2100" required :disabled="busy || config?.event.configLocked" data-testid="config-year" /></label>
          <label class="tournament-field"><span>{{ $t('tournament.region') }}</span><select v-model="form.region" :disabled="busy || config?.event.configLocked"><option v-for="value in TOURNAMENT_REGIONS" :key="value" :value="value">{{ $t('tournament.regions.' + value) }}</option></select></label>
          <label class="tournament-field"><span>{{ $t('tournament.season') }}</span><select v-model="form.season" :disabled="busy || config?.event.configLocked"><option v-for="value in TOURNAMENT_SEASONS" :key="value" :value="value">{{ $t('tournament.seasons.' + value) }}</option></select></label>
          <label class="tournament-field"><span>{{ $t('tournament.rounds') }}</span><select v-model.number="form.roundCount" :disabled="busy || config?.event.configLocked"><option :value="4">4</option><option :value="5">5</option></select></label>
          <label class="tournament-field"><span>{{ $t('tournament.days') }}</span><select v-model.number="form.daysPerRound" :disabled="busy || config?.event.configLocked"><option :value="2">2</option><option :value="3">3</option></select></label>
        </div>
        <div class="tournament-toolbar">
          <label class="tournament-field"><span>{{ $t('tournament.dayNaming') }}</span><select v-model="naming" :disabled="busy" @change="chooseNaming"><option value="DAY">{{ $t('tournament.dayMode') }}</option><option value="STAGE">{{ $t('tournament.stageMode') }}</option></select></label>
          <label v-for="day in form.daysPerRound" :key="day" class="tournament-field"><span>{{ $t('tournament.dayLabel', { number: day }) }}</span><input v-model="form.dayLabels[day - 1]" required maxlength="32" :disabled="busy" /></label>
        </div>
        <div class="tournament-actions"><AppButton type="submit" :disabled="busy || stale">{{ $t(config ? 'tournament.saveConfig' : 'tournament.createEvent') }}</AppButton>
          <AppButton v-if="config" variant="danger" :disabled="busy || stale" @click="deleteOpen = true">{{ $t('tournament.deleteEvent') }}</AppButton></div>
      </form>
      <form v-if="config" class="tournament-card" @submit.prevent="saveRules">
        <label class="tournament-field"><span>{{ $t('tournament.rounds') }}</span><select v-model.number="round" :disabled="busy"><option v-for="value in config.event.roundCount" :key="value" :value="value">{{ $t('tournament.round', { number: value }) }} · {{ $t(config.rounds.find(rule => rule.roundNumber === value)?.complete ? 'tournament.ready' : 'tournament.incomplete') }}</option></select></label>
        <p class="tournament-muted">{{ $t('tournament.ruleHint') }}</p>
        <Banner v-if="rule?.locked">{{ $t('tournament.rulesLocked') }}</Banner>
        <section v-for="day in config.event.daysPerRound" :key="day" class="tournament-stack">
          <h3>{{ config.event.dayLabels[day - 1] }}</h3>
          <div class="tournament-toolbar"><label v-for="rank in 5" :key="rank" class="tournament-field">
            <span>{{ $t('tournament.place', { number: rank }) }}<template v-if="rank === 5"> · {{ $t('tournament.optional') }}</template></span>
            <input v-if="ruleInputs[day - 1]" v-model="ruleInputs[day - 1][rank - 1]" type="number" min="0" max="1000000" step="1" :required="rank < 5" :disabled="busy || rule?.locked" :data-testid="`rule-${day}-${rank}`" />
          </label></div>
        </section>
        <AppButton variant="primary" type="submit" :disabled="busy || stale || rule?.locked || !ruleDays" data-testid="save-round-rules">{{ $t('tournament.saveRules') }}</AppButton>
      </form>
    </template>
    <AppDialog :open="deleteOpen" :title="$t('tournament.deleteEvent')" tone="danger" @close="!busy && (deleteOpen = false)">
      <p>{{ $t('tournament.deleteHint') }}</p><template #actions><AppButton :disabled="busy" @click="deleteOpen = false">{{ $t('tournament.cancel') }}</AppButton><AppButton variant="danger" :disabled="busy" @click="deleteConfirmed">{{ $t('tournament.deleteConfirm') }}</AppButton></template>
    </AppDialog>
  </div>
</template>
