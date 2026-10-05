<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TournamentImageReview } from '../composables/useTournamentPointsAdmin.js'
import { normalizeTournamentClan } from '../composables/useTournamentPointsAdmin.js'
import { apiErrorLabel } from '../utils/display.js'
import Banner from './Banner.vue'
import AppButton from './AppButton.vue'
const props = defineProps<{ review: TournamentImageReview; clans: string[]; duplicate: boolean; disabled: boolean }>()
const emit = defineEmits<{
  change: [value: Partial<TournamentImageReview>]
  teamChange: [index: number, key: 'clanTag' | 'rank', value: string | number]
  clanConfirm: [tag: string, checked: boolean]
  retry: []
  remove: []
}>()
const { t, te } = useI18n()
const clanListId = `tournament-clans-${useId()}`
const newClans = computed(() => [...new Set(props.review.teams.map(team => normalizeTournamentClan(team.clanTag)).filter(tag => tag && !props.clans.includes(tag)))])
</script>
<template>
  <section class="tournament-card">
    <h3>{{ review.file.name }}</h3>
    <div class="tournament-review">
      <img :src="review.url" :alt="$t('tournament.evidence')" />
      <div class="tournament-stack">
        <Banner v-if="review.error" tone="danger">{{ apiErrorLabel(t, te, review.error) }}<template #actions><AppButton :disabled="disabled" @click="emit('retry')">{{ $t('tournament.retryImage') }}</AppButton></template></Banner>
        <template v-if="review.result">
          <Banner v-if="review.result.issues.length" tone="warning">{{ $t('tournament.issue') }}</Banner>
          <label class="tournament-field"><span>{{ $t('tournament.groupNumber') }}</span><input :value="review.groupNumber" type="number" min="1" max="10000" :disabled="disabled" @input="emit('change', { groupNumber: Number(($event.target as HTMLInputElement).value), complete: false })" /></label>
          <div v-for="(team, index) in review.teams" :key="index" class="tournament-team-row">
            <label class="tournament-field"><span>{{ $t('tournament.clan') }}</span><input :value="team.clanTag" :list="clanListId" maxlength="64" :disabled="disabled" @input="emit('teamChange', index, 'clanTag', ($event.target as HTMLInputElement).value)" /></label>
            <label class="tournament-field"><span>{{ $t('tournament.rank') }} · {{ review.result.teams[index]?.rankText }}</span><select :value="team.rank ?? ''" :disabled="disabled" @change="emit('teamChange', index, 'rank', Number(($event.target as HTMLSelectElement).value))"><option value="">{{ $t('tournament.choose') }}</option><option v-for="rank in 5" :key="rank" :value="rank">{{ rank }}</option></select></label>
          </div>
          <datalist :id="clanListId"><option v-for="tag in clans" :key="tag" :value="tag" /></datalist>
          <template v-if="duplicate">
            <Banner tone="warning">{{ $t('tournament.duplicate') }}</Banner>
            <label class="tournament-field"><span>{{ $t('tournament.duplicateAction') }}</span><select :value="review.duplicateAction" :disabled="disabled" @change="emit('change', { duplicateAction: ($event.target as HTMLSelectElement).value as TournamentImageReview['duplicateAction'] })"><option value="ERROR">{{ $t('tournament.choose') }}</option><option value="REPLACE">{{ $t('tournament.replace') }}</option><option value="SKIP">{{ $t('tournament.skip') }}</option></select></label>
          </template>
          <template v-if="review.duplicateAction !== 'SKIP'">
            <label v-for="tag in newClans" :key="tag" class="tournament-check"><input type="checkbox" :checked="review.confirmedClans.includes(tag)" :disabled="disabled" @change="emit('clanConfirm', tag, ($event.target as HTMLInputElement).checked)" />{{ $t('tournament.newClan', { clan: tag }) }}</label>
            <label class="tournament-check"><input type="checkbox" :checked="review.complete" :disabled="disabled" @change="emit('change', { complete: ($event.target as HTMLInputElement).checked })" />{{ $t('tournament.complete') }}</label>
          </template>
        </template>
        <AppButton variant="ghost" :disabled="disabled" @click="emit('remove')">{{ $t('upload.remove_title') }}</AppButton>
      </div>
    </div>
  </section>
</template>
