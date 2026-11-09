<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { Plus } from 'lucide-vue-next'
import { useTournamentPointsConfig } from '../composables/useTournamentPointsConfig.js'
import { TOURNAMENT_REGIONS, TOURNAMENT_SEASONS } from '../api/tournament-points.js'
import { apiErrorLabel } from '../utils/display.js'
import ShowcaseHero from './ShowcaseHero.vue'
import Banner from './Banner.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import SegmentedControl from './SegmentedControl.vue'
import TournamentEventSelect from './TournamentEventSelect.vue'
import { localizedDayLabel } from '../utils/tournamentPointsExport.js'
import '../styles/tournament-points.css'
const { t, te } = useI18n()
const { globalMode, selectGlobal, selectEvent, roundComplete, defaultEnabled, defaults, ruleSource, defaultConfirmation, dirty, isDefaultSource, canSetDefault, missingDefaultDays, requestDefault, cancelDefault, confirmDefault, events, eventId, config, form, round, ruleInputs, rule, ruleDays, busy, error, stale, notice, allowed, refresh, saveConfig, saveRules, removeEvent, newEvent } = useTournamentPointsConfig()
const naming = ref('DAY'), deleteOpen = ref(false)
watch(config, value => { naming.value = value?.event.dayLabels.slice(0, 2).every(label => /^Day \d+$/.test(label)) === false ? 'STAGE' : 'DAY' })
function chooseNaming(value: string) {
  naming.value = value
  form.value.dayLabels = Array.from({ length: form.value.daysPerRound }, (_, i) => naming.value === 'STAGE' && i < 2
    ? t(i === 0 ? 'tournament.groupStage' : 'tournament.finalStage') : `Day ${i + 1}`)
}
async function deleteConfirmed() { await removeEvent(); deleteOpen.value = false }
const structureLocked = computed(() => busy.value || !!config.value?.event.configLocked)
const roundCountOptions = computed(() => [4, 5].map(value => ({ value: String(value), label: String(value), disabled: structureLocked.value, testid: `config-round-count-${value}` })))
const dayCountOptions = computed(() => [2, 3].map(value => ({ value: String(value), label: String(value), disabled: structureLocked.value, testid: `config-day-count-${value}` })))
const namingOptions = computed(() => [{ value: 'DAY', label: t('tournament.dayMode') }, { value: 'STAGE', label: t('tournament.stageMode') }]
  .map(option => ({ ...option, disabled: busy.value })))
const roundTotal = computed(() => globalMode.value ? form.value.roundCount : config.value?.event.roundCount ?? 0)
const dayTotal = computed(() => globalMode.value ? form.value.daysPerRound : config.value?.event.daysPerRound ?? 0)
function dayName(day: number) { return globalMode.value ? t('tournament.day', { number: day }) : localizedDayLabel(config.value!.event.dayLabels[day - 1], day, t) }
function roundBadge(number: number) {
  if (!globalMode.value && config.value?.rounds.find(value => value.roundNumber === number)?.locked) return t('tournament.lockedShort')
  return t(roundComplete(number) ? 'tournament.ready' : 'tournament.incomplete')
}
const blank = (value: unknown) => value == null || String(value).trim() === ''
// 必填空格：第 1–4 名为空即标出；第 5 名选填不标。只读当前输入，不改变保存规则（tournamentRulesFromInputs 仍是唯一校验）。
const missingCells = computed(() => Array.from({ length: dayTotal.value }, (_, i) => i + 1)
  .map(day => ({ day, ranks: [1, 2, 3, 4].filter(rank => blank(ruleInputs.value[day - 1]?.[rank - 1])) }))
  .filter(item => item.ranks.length))
</script>
<template>
  <div class="tournament-page tournament-stack tournament-admin tournament-config">
    <ShowcaseHero compact section="admin" :kicker="$t('more.sections.admin')" :title="$t('tournament.configTitle')"><template #actions>
      <TournamentEventSelect v-if="allowed" compact :model-value="eventId" :events="events" :disabled="busy" :include-global="!!defaults" :global-selected="globalMode" @update:model-value="selectEvent" @select-global="selectGlobal" />
      <AppButton v-if="allowed" :disabled="busy" data-testid="config-new-event" @click="newEvent"><Plus :size="16" aria-hidden="true" />{{ $t('tournament.newEvent') }}</AppButton>
      <RouterLink class="tournament-header-link" :to="{ path: '/', query: { view: 'tournament-points-admin' } }">{{ $t('tournament.statistics') }}</RouterLink>
      <AppButton :disabled="busy" @click="refresh">{{ $t('tournament.refresh') }}</AppButton>
    </template></ShowcaseHero>
    <Banner v-if="!allowed" tone="danger">{{ $t('tournament.adminRequired') }}</Banner>
    <template v-else>
      <Banner v-if="error" tone="danger">{{ stale ? $t('tournament.stale') : apiErrorLabel(t, te, error) }}</Banner>
      <Banner v-else-if="notice">{{ $t('tournament.' + notice) }}</Banner>
      <p v-if="busy" role="status">{{ $t('tournament.loading') }}</p>
      <div class="tournament-config-layout">
        <div class="tournament-config-side">
          <form class="tournament-card tournament-event-form" aria-labelledby="config-structure-heading" @submit.prevent="saveConfig">
            <div class="tournament-section-heading">
              <div>
                <h2 id="config-structure-heading">{{ $t('tournament.structureTitle') }}</h2>
                <p v-if="config && !globalMode" class="tournament-config-event"><span class="tournament-board-year">{{ config.event.year }}</span> · {{ $t('tournament.regions.' + config.event.region) }} · {{ $t('tournament.seasons.' + config.event.season) }}</p>
                <p v-else class="tournament-config-event">{{ $t(globalMode ? 'tournament.globalConfiguration' : 'tournament.newEvent') }}</p>
              </div>
              <span v-if="config?.event.configLocked" class="tournament-status">{{ $t('tournament.configLockedLabel') }}</span>
            </div>
            <p class="tournament-muted">{{ $t(globalMode ? 'tournament.globalEditHint' : 'tournament.identity') }}</p>
            <div class="tournament-config-fields">
              <label v-if="!globalMode" class="tournament-field"><span>{{ $t('tournament.year') }}</span><input v-model.number="form.year" type="number" inputmode="numeric" min="2000" max="2100" required :disabled="busy || config?.event.configLocked" data-testid="config-year" /></label>
              <label v-if="!globalMode" class="tournament-field"><span>{{ $t('tournament.region') }}</span><select v-model="form.region" :disabled="busy || config?.event.configLocked"><option v-for="value in TOURNAMENT_REGIONS" :key="value" :value="value">{{ $t('tournament.regions.' + value) }}</option></select></label>
              <label class="tournament-field"><span>{{ $t('tournament.season') }}</span><select v-if="globalMode" value="GLOBAL" disabled data-testid="config-season"><option value="GLOBAL">{{ $t('tournament.globalConfiguration') }}</option></select><select v-else v-model="form.season" data-testid="config-season" :disabled="busy || config?.event.configLocked"><option v-for="value in TOURNAMENT_SEASONS" :key="value" :value="value">{{ $t('tournament.seasons.' + value) }}</option></select></label>
              <div class="tournament-field"><span id="config-round-count-label">{{ $t('tournament.rounds') }}</span>
                <SegmentedControl :model-value="String(form.roundCount)" :options="roundCountOptions" :ariaLabel="$t('tournament.rounds')" data-testid="config-round-count" @update:model-value="form.roundCount = Number($event)" />
              </div>
              <div class="tournament-field"><span>{{ $t('tournament.days') }}</span>
                <SegmentedControl :model-value="String(form.daysPerRound)" :options="dayCountOptions" :ariaLabel="$t('tournament.days')" data-testid="config-day-count" @update:model-value="form.daysPerRound = Number($event)" />
              </div>
            </div>
            <p v-if="config?.event.configLocked" class="tournament-muted">{{ $t('tournament.structureLocked') }}</p>
            <div v-if="!globalMode" class="tournament-form-section tournament-config-fields">
              <div class="tournament-field tournament-field-wide"><span>{{ $t('tournament.dayNaming') }}</span>
                <SegmentedControl :model-value="naming" :options="namingOptions" presentation="tiles" :ariaLabel="$t('tournament.dayNaming')" data-testid="config-day-naming" @update:model-value="chooseNaming" />
              </div>
              <label v-for="day in form.daysPerRound" :key="day" class="tournament-field"><span>{{ $t('tournament.dayLabel', { number: day }) }}</span><input v-model="form.dayLabels[day - 1]" required maxlength="32" :disabled="busy" /></label>
            </div>
            <div v-if="!globalMode" class="tournament-actions"><AppButton :variant="config ? 'secondary' : 'primary'" type="submit" :disabled="busy || stale">{{ $t(config ? 'tournament.saveConfig' : 'tournament.createEvent') }}</AppButton>
              <AppButton v-if="config" variant="danger" :disabled="busy || stale" @click="deleteOpen = true">{{ $t('tournament.deleteEvent') }}</AppButton></div>
          </form>
          <section v-if="defaults" class="tournament-card tournament-default" aria-labelledby="default-rules-heading">
            <div class="tournament-default-heading">
              <h2 id="default-rules-heading">{{ $t('tournament.ruleSourceTitle') }}</h2>
            </div>
            <p v-if="ruleSource" class="tournament-config-source">{{ $t('tournament.ruleSources.' + ruleSource.source) }}</p>
            <button type="button" role="switch" class="tournament-default-switch" :aria-checked="defaultEnabled"
              :aria-label="$t('tournament.setDefault')" :disabled="busy || stale || (defaultEnabled ? (!globalMode && dirty) : !canSetDefault)"
              data-testid="default-rules-switch" @click="requestDefault(defaultEnabled ? 'clear' : 'set')">
              <span class="tournament-default-track" aria-hidden="true"><span class="tournament-default-thumb" /></span>
              <span>{{ $t('tournament.setDefault') }}</span>
            </button>
            <p class="tournament-muted">{{ $t('tournament.defaultHint') }}</p>
            <p v-if="!defaults.active" class="tournament-muted">{{ $t('tournament.defaultNone') }}</p>
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
        </div>
        <form v-if="config || (globalMode && defaults)" class="tournament-card tournament-rules-form" aria-labelledby="rules-heading" @submit.prevent="saveRules">
          <h2 id="rules-heading" class="tournament-rules-title">{{ $t('tournament.roundRules') }}</h2>
          <div class="tournament-round-tabs" role="tablist" :aria-label="$t('tournament.rounds')">
            <button v-for="value in roundTotal" :key="value" type="button" role="tab" class="tournament-round-tab" :class="{ 'is-incomplete': !roundComplete(value) }"
              :aria-selected="round === value" :disabled="busy" :data-testid="`rules-round-${value}`" @click="round = value">
              {{ $t('tournament.round', { number: value }) }}<span class="tournament-round-badge">{{ roundBadge(value) }}</span>
            </button>
          </div>
          <div class="tournament-rules-body" role="tabpanel">
            <p class="tournament-muted">{{ $t('tournament.ruleHint') }}</p>
            <Banner v-if="rule?.locked">{{ $t('tournament.rulesLocked') }}</Banner>
            <div class="tournament-table-wrap">
              <table class="tournament-rule-matrix">
                <thead><tr><th scope="col">{{ $t('tournament.placeColumn') }}</th><th v-for="day in dayTotal" :key="day" scope="col">{{ dayName(day) }}</th></tr></thead>
                <tbody>
                  <tr v-for="rank in 5" :key="rank">
                    <th scope="row">{{ $t('tournament.place', { number: rank }) }}<span v-if="rank === 5" class="tournament-muted"> · {{ $t('tournament.optional') }}</span></th>
                    <td v-for="day in dayTotal" :key="day">
                      <input v-if="ruleInputs[day - 1]" v-model="ruleInputs[day - 1][rank - 1]" type="number" inputmode="numeric" min="0" max="1000000" step="1" :required="rank < 5"
                        :class="{ 'is-missing': rank < 5 && blank(ruleInputs[day - 1][rank - 1]) }" :aria-invalid="rank < 5 && blank(ruleInputs[day - 1][rank - 1]) ? 'true' : undefined"
                        :aria-label="`${dayName(day)} · ${$t('tournament.place', { number: rank })}`" :placeholder="rank < 5 ? $t('tournament.required') : '—'"
                        :disabled="busy || rule?.locked" :data-testid="`rule-${day}-${rank}`" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul v-if="missingCells.length" class="tournament-missing" data-testid="rules-missing">
              <li v-for="item in missingCells" :key="item.day">{{ $t('tournament.missingCells', { day: dayName(item.day), ranks: item.ranks.join(', ') }) }}</li>
            </ul>
          </div>
          <div class="tournament-sticky-bar" role="group" :aria-label="$t('tournament.roundRules')">
            <span class="tournament-sticky-status" role="status">{{ $t(dirty ? 'tournament.unsavedChanges' : 'tournament.noUnsavedChanges') }}</span>
            <AppButton variant="ghost" :disabled="busy || !dirty" data-testid="discard-rule-changes" @click="refresh">{{ $t('tournament.discardChanges') }}</AppButton>
            <AppButton variant="primary" type="submit" :disabled="busy || stale || rule?.locked || (globalMode ? !canSetDefault : !ruleDays)" data-testid="save-round-rules">{{ $t(globalMode ? 'tournament.saveGlobalRules' : 'tournament.saveRules') }}</AppButton>
          </div>
        </form>
      </div>
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
