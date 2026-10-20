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
import { localizedDayLabel } from '../utils/tournamentPointsExport.js'
import '../styles/tournament-points.css'
const { t, te } = useI18n()
const { globalMode, selectGlobal, selectEvent, roundComplete, defaultEnabled, defaults, ruleSource, defaultConfirmation, dirty, isDefaultSource, canSetDefault, missingDefaultDays, requestDefault, cancelDefault, confirmDefault, events, eventId, config, form, round, ruleInputs, rule, ruleDays, busy, error, stale, notice, allowed, refresh, saveConfig, saveRules, removeEvent, newEvent } = useTournamentPointsConfig()
const naming = ref('DAY'), deleteOpen = ref(false)
watch(config, value => { naming.value = value?.event.dayLabels.slice(0, 2).every(label => /^Day \d+$/.test(label)) === false ? 'STAGE' : 'DAY' })
function chooseNaming() {
  form.value.dayLabels = Array.from({ length: form.value.daysPerRound }, (_, i) => naming.value === 'STAGE' && i < 2
    ? t(i === 0 ? 'tournament.groupStage' : 'tournament.finalStage') : `Day ${i + 1}`)
}
async function deleteConfirmed() { await removeEvent(); deleteOpen.value = false }
</script>
<template>
  <div class="tournament-page tournament-stack tournament-admin tournament-config">
    <PageHeader :title="$t('tournament.configTitle')"><template #actions>
      <RouterLink :to="{ path: '/', query: { view: 'tournament-points-admin' } }">{{ $t('tournament.statistics') }}</RouterLink>
      <AppButton :disabled="busy" @click="refresh">{{ $t('tournament.refresh') }}</AppButton>
    </template></PageHeader>
    <Banner v-if="!allowed" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <template v-else>
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <Banner v-else-if="notice">{{ $t('tournament.' + notice) }}</Banner>
      <p v-if="busy" role="status">{{ $t('tournament.loading') }}</p>
      <section class="tournament-card tournament-selection" aria-labelledby="config-selection-heading">
        <div class="tournament-section-heading">
          <div><h2 id="config-selection-heading">{{ $t('tournament.selectEvent') }}</h2><p class="tournament-muted">{{ $t('tournament.configSelectionHint') }}</p></div>
          <AppButton :disabled="busy" @click="newEvent">{{ $t('tournament.newEvent') }}</AppButton>
        </div>
        <TournamentEventSelect :model-value="eventId" :events="events" :disabled="busy" :include-global="!!defaults" :global-selected="globalMode" @update:model-value="selectEvent" @select-global="selectGlobal" />
      </section>
      <section v-if="defaults" class="tournament-card tournament-default" aria-labelledby="default-rules-heading">
        <div class="tournament-default-heading">
          <h2 id="default-rules-heading">{{ $t('tournament.defaultTitle') }}</h2>
          <button type="button" role="switch" class="tournament-default-switch" :aria-checked="defaultEnabled"
            :aria-label="$t('tournament.setDefault')" :disabled="busy || stale || (defaultEnabled ? (!globalMode && dirty) : !canSetDefault)"
            data-testid="default-rules-switch" @click="requestDefault(defaultEnabled ? 'clear' : 'set')">
            <span class="tournament-default-track" aria-hidden="true"><span class="tournament-default-thumb" /></span>
            <span>{{ $t('tournament.setDefault') }}</span>
          </button>
        </div>
        <p class="tournament-muted">{{ $t('tournament.defaultHint') }}</p>
        <p v-if="!defaults.active" class="tournament-muted">{{ $t('tournament.defaultNone') }}</p>
        <p v-if="ruleSource" class="tournament-muted">{{ $t('tournament.ruleSources.' + ruleSource.source) }}</p>
        <p v-if="dirty && config" role="status">{{ $t('tournament.defaultSaveFirst') }}</p>
        <p v-else-if="config && !config.rounds.every(item => item.complete)">{{ $t('tournament.defaultCompleteFirst') }}</p>
        <Banner v-if="missingDefaultDays.length" tone="warning">
          {{ $t('tournament.defaultMissing') }}
          <ul><li v-for="item in missingDefaultDays" :key="`${item.round}-${item.day}`">{{ $t('tournament.defaultMissingDay', item) }}</li></ul>
        </Banner>
        <div class="tournament-actions">
          <template v-if="isDefaultSource && ruleSource?.defaultOutdated">
            <span>{{ $t('tournament.defaultOutdated') }}</span>
            <AppButton :disabled="!canSetDefault" data-testid="update-default-rules" @click="requestDefault('set')">{{ $t('tournament.defaultUpdate') }}</AppButton>
          </template>
          <AppButton v-if="defaults.active && !isDefaultSource && !globalMode" :disabled="busy || stale || (dirty && !!config)" data-testid="clear-default-rules" @click="requestDefault('clear')">{{ $t('tournament.defaultClear') }}</AppButton>
        </div>
      </section>
      <form class="tournament-card tournament-event-form" @submit.prevent="saveConfig">
        <div class="tournament-section-heading tournament-accent-heading">
          <div>
            <h2 v-if="config && !globalMode"><span class="tournament-board-year">{{ config.event.year }}</span> · {{ $t('tournament.regions.' + config.event.region) }} · {{ $t('tournament.seasons.' + config.event.season) }}</h2>
            <h2 v-else>{{ $t(globalMode ? 'tournament.globalConfiguration' : 'tournament.newEvent') }}</h2>
          </div>
          <span v-if="config?.event.configLocked" class="tournament-status">{{ $t('tournament.configLockedLabel') }}</span>
        </div>
        <p class="tournament-muted">{{ $t(globalMode ? 'tournament.globalEditHint' : 'tournament.identity') }}</p>
        <Banner v-if="config?.event.configLocked">{{ $t('tournament.structureLocked') }}</Banner>
        <div class="tournament-toolbar tournament-identity-fields">
          <label v-if="!globalMode" class="tournament-field"><span>{{ $t('tournament.year') }}</span><input v-model.number="form.year" type="number" min="2000" max="2100" required :disabled="busy || config?.event.configLocked" data-testid="config-year" /></label>
          <label v-if="!globalMode" class="tournament-field"><span>{{ $t('tournament.region') }}</span><select v-model="form.region" :disabled="busy || config?.event.configLocked"><option v-for="value in TOURNAMENT_REGIONS" :key="value" :value="value">{{ $t('tournament.regions.' + value) }}</option></select></label>
          <label class="tournament-field"><span>{{ $t('tournament.season') }}</span><select v-if="globalMode" value="GLOBAL" disabled data-testid="config-season"><option value="GLOBAL">{{ $t('tournament.globalConfiguration') }}</option></select><select v-else v-model="form.season" data-testid="config-season" :disabled="busy || config?.event.configLocked"><option v-for="value in TOURNAMENT_SEASONS" :key="value" :value="value">{{ $t('tournament.seasons.' + value) }}</option></select></label>
          <label class="tournament-field"><span>{{ $t('tournament.rounds') }}</span><select v-model.number="form.roundCount" data-testid="config-round-count" :disabled="busy || config?.event.configLocked"><option :value="4">4</option><option :value="5">5</option></select></label>
          <label class="tournament-field"><span>{{ $t('tournament.days') }}</span><select v-model.number="form.daysPerRound" data-testid="config-day-count" :disabled="busy || config?.event.configLocked"><option :value="2">2</option><option :value="3">3</option></select></label>
        </div>
        <div v-if="!globalMode" class="tournament-toolbar tournament-form-section">
          <label class="tournament-field"><span>{{ $t('tournament.dayNaming') }}</span><select v-model="naming" :disabled="busy" @change="chooseNaming"><option value="DAY">{{ $t('tournament.dayMode') }}</option><option value="STAGE">{{ $t('tournament.stageMode') }}</option></select></label>
          <label v-for="day in form.daysPerRound" :key="day" class="tournament-field"><span>{{ $t('tournament.dayLabel', { number: day }) }}</span><input v-model="form.dayLabels[day - 1]" required maxlength="32" :disabled="busy" /></label>
        </div>
        <div v-if="!globalMode" class="tournament-actions"><AppButton :variant="config ? 'secondary' : 'primary'" type="submit" :disabled="busy || stale">{{ $t(config ? 'tournament.saveConfig' : 'tournament.createEvent') }}</AppButton>
          <AppButton v-if="config" variant="danger" :disabled="busy || stale" @click="deleteOpen = true">{{ $t('tournament.deleteEvent') }}</AppButton></div>
      </form>
      <form v-if="config || (globalMode && defaults)" class="tournament-card tournament-rules-form" @submit.prevent="saveRules">
        <h2>{{ $t('tournament.roundRules') }}</h2>
        <label class="tournament-field"><span>{{ $t('tournament.rounds') }}</span><select v-model.number="round" :disabled="busy" data-testid="rules-round"><option v-for="value in globalMode ? form.roundCount : config!.event.roundCount" :key="value" :value="value">{{ $t('tournament.round', { number: value }) }} · {{ $t(roundComplete(value) ? 'tournament.ready' : 'tournament.incomplete') }}</option></select></label>
        <p class="tournament-muted">{{ $t('tournament.ruleHint') }}</p>
        <Banner v-if="rule?.locked">{{ $t('tournament.rulesLocked') }}</Banner>
        <section v-for="day in globalMode ? form.daysPerRound : config!.event.daysPerRound" :key="day" class="tournament-rule-day">
          <h3>{{ globalMode ? $t('tournament.day', { number: day }) : localizedDayLabel(config!.event.dayLabels[day - 1], day, t) }}</h3>
          <div class="tournament-rule-grid"><label v-for="rank in 5" :key="rank" class="tournament-field">
            <span>{{ $t('tournament.place', { number: rank }) }}<template v-if="rank === 5"> · {{ $t('tournament.optional') }}</template></span>
            <input v-if="ruleInputs[day - 1]" v-model="ruleInputs[day - 1][rank - 1]" type="number" min="0" max="1000000" step="1" :required="rank < 5" :disabled="busy || rule?.locked" :data-testid="`rule-${day}-${rank}`" />
          </label></div>
        </section>
        <AppButton variant="primary" type="submit" :disabled="busy || stale || rule?.locked || (globalMode ? !canSetDefault : !ruleDays)" data-testid="save-round-rules">{{ $t(globalMode ? 'tournament.saveGlobalRules' : 'tournament.saveRules') }}</AppButton>
      </form>
    </template>
    <AppDialog :open="!!defaultConfirmation" :title="$t(defaultConfirmation?.action === 'clear' ? 'tournament.defaultClear' : 'tournament.defaultUpdate')" @close="cancelDefault" data-testid="default-rules-dialog">
      <p>{{ $t(defaultConfirmation?.action === 'clear' ? 'tournament.defaultClearConfirm' : 'tournament.defaultReplaceConfirm') }}</p>
      <p v-if="defaultConfirmation?.action !== 'clear'">{{ $t(globalMode ? 'tournament.globalSaveEffect' : 'tournament.defaultReplaceEffect') }}</p>
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <template #actions>
        <AppButton :disabled="busy" data-testid="cancel-default-rules" @click="cancelDefault">{{ $t('tournament.cancel') }}</AppButton>
        <AppButton variant="primary" :disabled="busy || stale || (dirty && !!config)" data-testid="confirm-default-rules" @click="confirmDefault">{{ $t(defaultConfirmation?.action === 'clear' ? 'tournament.defaultClearYes' : 'tournament.defaultReplaceYes') }}</AppButton>
      </template>
    </AppDialog>
    <AppDialog :open="deleteOpen" :title="$t('tournament.deleteEvent')" tone="danger" @close="!busy && (deleteOpen = false)">
      <p>{{ $t('tournament.deleteHint') }}</p><template #actions><AppButton :disabled="busy" @click="deleteOpen = false">{{ $t('tournament.cancel') }}</AppButton><AppButton variant="danger" :disabled="busy" @click="deleteConfirmed">{{ $t('tournament.deleteConfirm') }}</AppButton></template>
    </AppDialog>
  </div>
</template>
