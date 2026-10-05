import { ref, computed, watch, onScopeDispose } from 'vue'
import * as api from '../api/tournament-points.js'
import type { TournamentConfig, TournamentEvent, TournamentCreateRequest, TournamentRuleRequest } from '../api/tournament-points.js'
import { useAuth } from './useAuth.js'
import type { KeycloakTokenParsed } from 'keycloak-js'

/** Blank required cells never become zero; optional fifth place is omitted. */
export function tournamentRulesFromInputs(inputs: (number | string | null)[][]): TournamentRuleRequest['days'] | null {
  if (inputs.length < 2 || inputs.length > 3) return null
  const days: TournamentRuleRequest['days'] = []
  for (let i = 0; i < inputs.length; i++) {
    const points: TournamentRuleRequest['days'][number]['points'] = []
    for (let rank = 1; rank <= 5; rank++) {
      const raw = inputs[i][rank - 1]
      if (raw == null || String(raw).trim() === '') { if (rank <= 4) return null; continue }
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 0 || value > 1000000) return null
      points.push({ rank, points: value })
    }
    days.push({ dayNumber: i + 1, points })
  }
  return days
}
export function useTournamentPointsConfig() {
  const auth = useAuth()
  const allowed = computed(() => api.tournamentAdminAllowed(auth))
  const events = ref<TournamentEvent[]>([])
  const eventId = ref<number | null>(null)
  const config = ref<TournamentConfig | null>(null)
  const form = ref<TournamentCreateRequest>({ year: new Date().getFullYear(), region: 'CN', season: 'SPRING', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'] })
  const round = ref(1)
  const ruleInputs = ref<(number | string | null)[][]>([])
  const busy = ref(false), error = ref<unknown>(null), stale = ref(false)
  const notice = ref('')
  let generation = 0, controller = new AbortController()
  const rule = computed(() => config.value?.rounds.find(value => value.roundNumber === round.value))
  const ruleDays = computed(() => tournamentRulesFromInputs(ruleInputs.value))
  function fillRules() {
    ruleInputs.value = Array.from({ length: config.value?.event.daysPerRound || form.value.daysPerRound }, (_, day) =>
      Array.from({ length: 5 }, (_, rank) => rule.value?.days.find(value => value.dayNumber === day + 1)?.points.find(value => value.rank === rank + 1)?.points ?? ''))
  }
  function invalidate() { generation++; controller.abort(); controller = new AbortController(); busy.value = false; error.value = null; stale.value = false; notice.value = '' }
  async function task(run: (signal: AbortSignal) => Promise<void>) {
    if (!allowed.value || busy.value) return
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true; error.value = null; notice.value = ''
    try { await run(controller.signal) }
    catch (value) {
      if (gen === generation && epoch === auth.authEpoch()) {
        error.value = value; stale.value = (value as { errorCode?: string })?.errorCode === 'TOURNAMENT_VERSION_CONFLICT'
      }
    } finally { if (gen === generation && epoch === auth.authEpoch()) busy.value = false }
  }
  function apply(value: TournamentConfig) {
    config.value = value
    const { year, region, season, roundCount, daysPerRound, dayLabels } = value.event
    form.value = { year, region, season, roundCount, daysPerRound, dayLabels: [...dayLabels] }
    if (round.value > roundCount) round.value = 1
    fillRules()
  }
  async function refresh() {
    invalidate()
    const gen = generation, epoch = auth.authEpoch()
    config.value = null
    await task(async signal => {
      const [list, selected] = await Promise.all([api.listTournamentEvents(true, signal), eventId.value ? api.getTournamentConfig(eventId.value, signal) : Promise.resolve(null)])
      if (gen !== generation || epoch !== auth.authEpoch() || !allowed.value) return
      events.value = list
      if (selected) apply(selected)
    })
  }
  async function saveConfig() {
    if (stale.value) return
    const gen = generation, epoch = auth.authEpoch()
    await task(async signal => {
      const payload = { ...form.value, dayLabels: form.value.dayLabels.slice(0, form.value.daysPerRound) }
      const value = config.value
        ? await api.updateTournament(config.value.event.id, { ...payload, expectedVersion: config.value.event.version }, signal)
        : await api.createTournament(payload, signal)
      if (gen !== generation || epoch !== auth.authEpoch() || !allowed.value) return
      apply(value)
      notice.value = 'saved'
      if (!events.value.some(event => event.id === value.event.id)) events.value.push(value.event)
      eventId.value = value.event.id
    })
  }
  async function saveRules() {
    if (!ruleDays.value || !config.value || !rule.value || rule.value.locked || stale.value) return
    const gen = generation, epoch = auth.authEpoch()
    await task(async signal => {
      const value = await api.saveTournamentRules(config.value!.event.id, round.value, {
        expectedEventVersion: config.value!.event.version, expectedRulesVersion: rule.value!.rulesVersion, days: ruleDays.value!,
      }, signal)
      if (gen === generation && epoch === auth.authEpoch() && allowed.value) { apply(value); notice.value = 'rulesSaved' }
    })
  }
  async function removeEvent() {
    if (!config.value || stale.value) return
    const gen = generation, epoch = auth.authEpoch()
    await task(async signal => {
      await api.deleteTournament(config.value!.event.id, { expectedVersion: config.value!.event.version, confirm: true }, signal)
      if (gen === generation && epoch === auth.authEpoch() && allowed.value) { eventId.value = null; config.value = null; events.value = []; void refresh() }
    })
  }
  function newEvent() {
    eventId.value = null; config.value = null
    form.value = { year: new Date().getFullYear(), region: 'CN', season: 'SPRING', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'] }
    fillRules()
  }
  watch([eventId, () => (auth.tokenParsed.value as KeycloakTokenParsed | null)?.sub, allowed], () => {
    if (!allowed.value) { invalidate(); events.value = []; config.value = null }
    else void refresh()
  }, { immediate: true })
  watch(round, fillRules)
  watch(() => form.value.daysPerRound, count => {
    form.value.dayLabels = Array.from({ length: count }, (_, i) => form.value.dayLabels[i] || `Day ${i + 1}`)
  })
  onScopeDispose(invalidate)
  return { events, eventId, config, form, round, ruleInputs, rule, ruleDays, busy, error, stale, notice, allowed, refresh, saveConfig, saveRules, removeEvent, newEvent }
}
