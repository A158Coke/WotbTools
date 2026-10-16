import { ref, computed, watch, onScopeDispose } from 'vue'
import * as api from '../api/tournament-points.js'
import type { TournamentConfig, TournamentEvent, TournamentCreateRequest, TournamentRuleRequest } from '../api/tournament-points.js'
import { ApiError } from '../utils/http.js'
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
export function useTournamentPointsConfig(deps = { api, auth: useAuth() }) {
  const { auth } = deps
  const transport = deps.api
  const allowed = computed(() => api.tournamentAdminAllowed(auth))
  const events = ref<TournamentEvent[]>([])
  const eventId = ref<number | null>(null)
  const config = ref<TournamentConfig | null>(null)
  const globalMode = ref(false)
  const globalInputs = ref<(number | string | null)[][][]>([])
  const savedGlobalInputs = ref('')
  const form = ref<TournamentCreateRequest>({ year: new Date().getFullYear(), region: 'CN', season: 'SPRING', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'] })
  const round = ref(1)
  const localRuleInputs = ref<(number | string | null)[][]>([])
  const ruleInputs = computed({
    get: () => globalMode.value ? (globalInputs.value[round.value - 1] ?? []).slice(0, form.value.daysPerRound) : localRuleInputs.value,
    set: value => { if (globalMode.value) globalInputs.value[round.value - 1] = value; else localRuleInputs.value = value },
  })
  const globalRules = computed<api.TournamentDefaultRules['rounds'] | null>(() => {
    if (![4, 5].includes(form.value.roundCount) || ![2, 3].includes(form.value.daysPerRound)) return null
    const rounds: api.TournamentDefaultRules['rounds'] = []
    for (let index = 0; index < form.value.roundCount; index++) {
      const days = tournamentRulesFromInputs((globalInputs.value[index] ?? []).slice(0, form.value.daysPerRound))
      if (!days) return null
      rounds.push({ roundNumber: index + 1, days })
    }
    return rounds
  })
  function globalInputState() { return JSON.stringify({ roundCount: form.value.roundCount, daysPerRound: form.value.daysPerRound, inputs: globalInputs.value.map(value => value.map(day => day.map(String))) }) }
  function roundComplete(number: number) {
    return globalMode.value ? !!tournamentRulesFromInputs((globalInputs.value[number - 1] ?? []).slice(0, form.value.daysPerRound))
      : config.value?.rounds.find(value => value.roundNumber === number)?.complete === true
  }
  const busy = ref(false), error = ref<unknown>(null), stale = ref(false)
  const notice = ref('')
  const defaults = ref<api.TournamentDefaultRules | null>(null)
  const ruleSource = ref<api.TournamentRuleSource | null>(null)
  const defaultConfirmation = ref<{ action: 'set' | 'clear' | 'save'; version: number; eventId: number | null; eventVersion: number | null; rounds?: api.TournamentDefaultRules['rounds'] } | null>(null)
  const savedInputs = ref('')
  const formDirty = computed(() => {
    if (!config.value) return false
    const { year, region, season, roundCount, daysPerRound, dayLabels } = config.value.event
    return JSON.stringify(form.value) !== JSON.stringify({ year, region, season, roundCount, daysPerRound, dayLabels })
  })
  const dirty = computed(() => globalMode.value ? globalInputState() !== savedGlobalInputs.value : formDirty.value || JSON.stringify(ruleInputs.value.map(day => day.map(String))) !== savedInputs.value)
  const isDefaultSource = computed(() => !!config.value && defaults.value?.active === true && defaults.value.sourceEventId === config.value.event.id)
  const canSetDefault = computed(() => !!defaults.value && !busy.value && !stale.value && (globalMode.value ? !!globalRules.value
    : !!config.value && !!ruleSource.value && !dirty.value && config.value.rounds.length === config.value.event.roundCount && config.value.rounds.every(value => value.complete)))
  const defaultEnabled = computed(() => globalMode.value ? defaults.value?.active === true : isDefaultSource.value)
  const missingDefaultDays = computed(() => ruleSource.value?.source === 'INHERIT' && defaults.value?.active && config.value
    ? config.value.rounds.flatMap(value => Array.from({ length: config.value!.event.daysPerRound }, (_, i) => i + 1)
      .filter(day => ![1, 2, 3, 4].every(rank => value.days.find(item => item.dayNumber === day)?.points.some(point => point.rank === rank)))
      .map(day => ({ round: value.roundNumber, day }))) : [])
  let generation = 0, controller = new AbortController()
  const rule = computed(() => config.value?.rounds.find(value => value.roundNumber === round.value))
  const ruleDays = computed(() => tournamentRulesFromInputs(ruleInputs.value))
  function fillRules() {
    if (globalMode.value) return
    ruleInputs.value = Array.from({ length: config.value?.event.daysPerRound || form.value.daysPerRound }, (_, day) =>
      Array.from({ length: 5 }, (_, rank) => rule.value?.days.find(value => value.dayNumber === day + 1)?.points.find(value => value.rank === rank + 1)?.points ?? ''))
    savedInputs.value = JSON.stringify(ruleInputs.value.map(day => day.map(String)))
  }
  function invalidate() { generation++; controller.abort(); controller = new AbortController(); busy.value = false; error.value = null; stale.value = false; notice.value = ''; defaultConfirmation.value = null }
  function owns(gen: number, epoch: number) { return gen === generation && epoch === auth.authEpoch() && allowed.value && !controller.signal.aborted }
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
  function applyGlobal(value: api.TournamentDefaultRules) {
    form.value.roundCount = value.rounds.length === 4 ? 4 : 5
    form.value.daysPerRound = value.rounds.some(item => item.days.length === 3) ? 3 : 2
    globalInputs.value = Array.from({ length: 5 }, (_, index) => Array.from({ length: 3 }, (_, day) =>
      Array.from({ length: 5 }, (_, rank) => value.rounds.find(item => item.roundNumber === index + 1)?.days
        .find(item => item.dayNumber === day + 1)?.points.find(item => item.rank === rank + 1)?.points ?? '')))
    if (round.value > form.value.roundCount) round.value = 1
    savedGlobalInputs.value = globalInputState()
  }
  function selectGlobal() { globalMode.value = true }
  function selectEvent(value: number | null) { globalMode.value = false; eventId.value = value }
  async function loadConfig(id: number, signal: AbortSignal) {
    // Read the version before the effective rules: a concurrent default update can only
    // make this token older, never authorize saving old cells against a newer default.
    const source = await transport.getTournamentRuleSource(id, signal)
    const value = await transport.getTournamentConfig(id, signal)
    if (source && source.eventVersion !== value.event.version) throw new ApiError({ errorCode: 'TOURNAMENT_VERSION_CONFLICT', status: 409 })
    return { source, value }
  }
  async function refresh() {
    invalidate()
    const gen = generation, epoch = auth.authEpoch(), id = globalMode.value ? null : eventId.value
    config.value = null; ruleSource.value = null; defaults.value = null
    await task(async signal => {
      const [list, selected, currentDefault] = await Promise.all([transport.listTournamentEvents(true, signal), id ? loadConfig(id, signal) : Promise.resolve(null), transport.getTournamentDefaultRules(signal)])
      if (!owns(gen, epoch)) return
      events.value = list; defaults.value = currentDefault
      if (globalMode.value && currentDefault) applyGlobal(currentDefault)
      else if (selected) { apply(selected.value); ruleSource.value = selected.source }
    })
  }
  async function reloadSaved(id: number, signal: AbortSignal, gen: number, epoch: number) {
    const [selected, currentDefault] = await Promise.all([loadConfig(id, signal), transport.getTournamentDefaultRules(signal)])
    if (!owns(gen, epoch)) return
    apply(selected.value); ruleSource.value = selected.source; defaults.value = currentDefault
  }
  async function publishDefault(action: 'set' | 'clear' | 'save', version: number, signal: AbortSignal, gen: number, epoch: number, rounds?: api.TournamentDefaultRules['rounds']) {
    const id = config.value?.event.id
    const result = action === 'save'
      ? await transport.saveTournamentDefaultConfiguration({ expectedDefaultVersion: version, confirm: true, rounds: rounds! }, signal)
      : action === 'set'
      ? await transport.setTournamentDefaultRules({ eventId: id!, expectedEventVersion: config.value!.event.version, expectedDefaultVersion: version, confirm: true }, signal)
      : await transport.clearTournamentDefaultRules({ expectedDefaultVersion: version, confirm: true }, signal)
    if (!owns(gen, epoch)) return
    defaults.value = result; defaultConfirmation.value = null
    if (globalMode.value && action === 'save') applyGlobal(result)
    else if (id) await reloadSaved(id, signal, gen, epoch)
    if (owns(gen, epoch)) notice.value = action === 'clear' ? 'defaultCleared' : 'defaultSaved'
  }
  async function requestDefault(action: 'set' | 'clear' | 'save') {
    if (globalMode.value && action === 'set') action = 'save'
    if (stale.value || !defaults.value || (action !== 'clear' && !canSetDefault.value)) return
    if (dirty.value && config.value) { notice.value = 'defaultSaveFirst'; return }
    const gen = generation, epoch = auth.authEpoch(), expectedVersion = defaults.value.version
    const rounds = action === 'save' ? globalRules.value! : undefined
    await task(async signal => {
      const latest = await transport.getTournamentDefaultRules(signal)
      if (!owns(gen, epoch)) return
      defaults.value = latest
      if (!latest || (action === 'clear' && !latest.active)) return
      if ((action === 'save' && latest.version !== expectedVersion) || (action === 'set' && ruleSource.value?.source === 'INHERIT' && ruleSource.value.defaultVersion !== latest.version)) throw new ApiError({ errorCode: 'TOURNAMENT_VERSION_CONFLICT', status: 409 })
      if (latest.active) {
        defaultConfirmation.value = { action, version: latest.version, eventId: config.value?.event.id ?? null, eventVersion: config.value?.event.version ?? null, rounds }
      } else await publishDefault(action, latest.version, signal, gen, epoch, rounds)
    })
  }
  function cancelDefault() { if (!busy.value) defaultConfirmation.value = null }
  async function confirmDefault() {
    const pending = defaultConfirmation.value
    if (!pending || stale.value || dirty.value && !!config.value) return
    if (pending.eventId !== (config.value?.event.id ?? null) || pending.eventVersion !== (config.value?.event.version ?? null)) { defaultConfirmation.value = null; return }
    const gen = generation, epoch = auth.authEpoch()
    await task(signal => publishDefault(pending.action, pending.version, signal, gen, epoch, pending.rounds))
  }
  async function saveConfig() {
    if (globalMode.value) return requestDefault('save')
    if (stale.value) return
    const gen = generation, epoch = auth.authEpoch()
    await task(async signal => {
      const payload = { ...form.value, dayLabels: form.value.dayLabels.slice(0, form.value.daysPerRound) }
      const value = config.value
        ? await transport.updateTournament(config.value.event.id, { ...payload, expectedVersion: config.value.event.version }, signal)
        : await transport.createTournament(payload, signal)
      if (gen !== generation || epoch !== auth.authEpoch() || !allowed.value) return
      apply(value)
      if (eventId.value === value.event.id) await reloadSaved(value.event.id, signal, gen, epoch)
      if (!owns(gen, epoch)) return
      notice.value = 'saved'
      if (!events.value.some(event => event.id === value.event.id)) events.value.push(value.event)
      eventId.value = value.event.id
    })
  }
  async function saveRules() {
    if (globalMode.value) return requestDefault('save')
    if (!ruleDays.value || !config.value || !rule.value || rule.value.locked || stale.value) return
    const gen = generation, epoch = auth.authEpoch()
    await task(async signal => {
      const value = await transport.saveTournamentRules(config.value!.event.id, round.value, {
        expectedEventVersion: config.value!.event.version, expectedRulesVersion: rule.value!.rulesVersion, days: ruleDays.value!,
        ...(ruleSource.value ? { expectedDefaultVersion: ruleSource.value.defaultVersion } : {}),
      }, signal)
      if (owns(gen, epoch)) { apply(value); await reloadSaved(value.event.id, signal, gen, epoch); if (owns(gen, epoch)) notice.value = 'rulesSaved' }
    })
  }
  async function removeEvent() {
    if (!config.value || stale.value) return
    const gen = generation, epoch = auth.authEpoch()
    await task(async signal => {
      await transport.deleteTournament(config.value!.event.id, { expectedVersion: config.value!.event.version, confirm: true }, signal)
      if (gen === generation && epoch === auth.authEpoch() && allowed.value) { eventId.value = null; config.value = null; events.value = []; void refresh() }
    })
  }
  function newEvent() {
    invalidate(); globalMode.value = false; eventId.value = null; config.value = null; ruleSource.value = null
    form.value = { year: new Date().getFullYear(), region: 'CN', season: 'SPRING', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'] }
    fillRules()
  }
  watch([eventId, globalMode, () => (auth.tokenParsed.value as KeycloakTokenParsed | null)?.sub, allowed], () => {
    if (!allowed.value) { invalidate(); events.value = []; config.value = null; defaults.value = null; ruleSource.value = null }
    else void refresh()
  }, { immediate: true, flush: 'sync' })
  watch(round, fillRules)
  watch(() => form.value.roundCount, count => { if (globalMode.value && round.value > count) round.value = 1 })
  watch(() => form.value.daysPerRound, count => {
    form.value.dayLabels = Array.from({ length: count }, (_, i) => form.value.dayLabels[i] || `Day ${i + 1}`)
  })
  onScopeDispose(invalidate)
  return { globalMode, selectGlobal, selectEvent, globalRules, roundComplete, defaultEnabled, defaults, ruleSource, defaultConfirmation, dirty, isDefaultSource, canSetDefault, missingDefaultDays, requestDefault, cancelDefault, confirmDefault, events, eventId, config, form, round, ruleInputs, rule, ruleDays, busy, error, stale, notice, allowed, refresh, saveConfig, saveRules, removeEvent, newEvent }
}
