import { computed, onScopeDispose, ref, watch } from 'vue'
import * as api from '../api/tournament-points.js'
import { useAuth } from './useAuth.js'
import type { KeycloakTokenParsed } from 'keycloak-js'
import type { TournamentConfig, TournamentDayView, TournamentDraftRequest, TournamentIncomingGroup, TournamentRecognitionResult, TournamentAudit, TournamentEvent } from '../api/tournament-points.js'

/** Local review state is deliberately incomplete until the administrator checks the original. */
export interface TournamentImageReview {
  file: File
  url: string
  evidenceId: string
  result: TournamentRecognitionResult | null
  groupNumber: number | null
  teams: Pick<TournamentRecognitionResult['teams'][number], 'clanTag' | 'rank'>[]
  complete: boolean
  duplicateAction: TournamentIncomingGroup['duplicateAction']
  confirmedClans: string[]
  error: unknown
}
export function normalizeTournamentClan(value: string): string {
  const tag = value.trim()
  return tag.startsWith('[') && tag.endsWith(']') ? tag.slice(1, -1).trim() : tag
}

export function tournamentGroupReviewError(review: TournamentImageReview, config: TournamentConfig, round: number, day: number): string | null {
  if (review.duplicateAction === 'SKIP') return null
  if (review.result?.issues.some(issue => ['MULTIPLE_GROUPS', 'INCOMPLETE_GROUP'].includes(issue))) return 'imageIncomplete'
  if (!review.result || !review.complete || !Number.isInteger(review.groupNumber) || !review.groupNumber || review.groupNumber > 10000
    || review.teams.length < 3 || review.teams.length > 5) return 'invalidGroup'
  const tags = review.teams.map(team => normalizeTournamentClan(team.clanTag))
  const ranks = review.teams.map(team => team.rank).sort((a, b) => Number(a) - Number(b))
  if (tags.some(tag => !tag || Array.from(tag).length > 32) || new Set(tags).size !== tags.length
    || ranks.some((rank, i) => rank !== i + 1)) return 'invalidGroup'
  const rule = config.rounds.find(rule => rule.roundNumber === round)?.days.find(rule => rule.dayNumber === day)
  if (ranks.includes(5) && !rule?.points.some(points => points.rank === 5)) return 'fifthMissing'
  if (tags.some(tag => !config.clans.includes(tag) && !review.confirmedClans.includes(tag))) return 'unreviewed'
  return null
}

export function useTournamentPointsAdmin(deps = { api, auth: useAuth() }) {
  const { auth } = deps
  const transport = deps.api
  const allowed = computed(() => api.tournamentAdminAllowed(auth))
  const events = ref<TournamentEvent[]>([])
  const eventId = ref<number | null>(null)
  const round = ref(1)
  const day = ref(1)
  const config = ref<TournamentConfig | null>(null)
  const dayState = ref<TournamentDayView | null>(null)
  const previewState = ref<TournamentDayView | null>(null)
  const audit = ref<TournamentAudit[]>([])
  const reviews = ref<TournamentImageReview[]>([])
  const busy = ref(false)
  const recognizing = ref(false)
  const progress = ref(0)
  const error = ref<unknown>(null)
  const stale = ref(false)
  const notice = ref('')
  let generation = 0
  let controller = new AbortController()
  let publicationKey = crypto.randomUUID()

  function clearReviews() {
    reviews.value.forEach(review => URL.revokeObjectURL(review.url))
    reviews.value = []
    previewState.value = null
  }
  function invalidate() {
    generation++
    controller.abort()
    controller = new AbortController()
    busy.value = false
    recognizing.value = false
    error.value = null
    stale.value = false
    notice.value = ''
    clearReviews()
    publicationKey = crypto.randomUUID()
  }
  function owns(gen: number, epoch: number) {
    return gen === generation && epoch === auth.authEpoch() && allowed.value && !controller.signal.aborted
  }
  function fail(value: unknown) {
    if ((value as { name?: string })?.name === 'AbortError' || (value as { code?: string })?.code === 'REQUEST_ABORTED') return
    error.value = value
    stale.value = (value as { errorCode?: string })?.errorCode === 'TOURNAMENT_VERSION_CONFLICT'
  }
  function applyDay(value: TournamentDayView) {
    // Only owned successful responses reach this transition. A correction is a new
    // publication; an uncertain/failed publication retry keeps its existing key.
    if (dayState.value?.status === 'FINALIZED' && value.status === 'CORRECTION') publicationKey = crypto.randomUUID()
    dayState.value = value
    previewState.value = null
    if (config.value) config.value.event.version = value.eventVersion
  }
  async function loadSelection() {
    invalidate()
    const gen = generation, epoch = auth.authEpoch(), signal = controller.signal
    dayState.value = null
    config.value = null
    audit.value = []
    if (!allowed.value || !eventId.value) return
    busy.value = true
    try {
      const cfg = await transport.getTournamentConfig(eventId.value, signal)
      if (!owns(gen, epoch)) return
      config.value = cfg
      if (round.value > cfg.event.roundCount || day.value > cfg.event.daysPerRound) { round.value = 1; day.value = 1; return }
      const [value, entries] = await Promise.all([
        transport.getTournamentDay(eventId.value, round.value, day.value, signal),
        transport.getTournamentAudit(eventId.value, signal),
      ])
      if (!owns(gen, epoch)) return
      applyDay(value)
      audit.value = entries
    } catch (value) { if (owns(gen, epoch)) fail(value) }
    finally { if (owns(gen, epoch)) busy.value = false }
  }
  async function loadEvents() {
    if (!allowed.value) return
    const gen = generation, epoch = auth.authEpoch()
    try {
      const value = await transport.listTournamentEvents(true, controller.signal)
      if (owns(gen, epoch)) events.value = value
    } catch (value) { if (owns(gen, epoch)) fail(value) }
  }
  const roundRule = computed(() => config.value?.rounds.find(rule => rule.roundNumber === round.value))
  const editable = computed(() => allowed.value && !!dayState.value && !!roundRule.value?.complete
    && dayState.value.status !== 'FINALIZED' && !busy.value && !recognizing.value && !stale.value)
  const canUpload = computed(() => editable.value && !!dayState.value?.expectedGroupCount)
  const standings = computed(() => previewState.value?.standings ?? dayState.value?.standings ?? null)
  const reviewSelection = computed(() => {
    const selected = new Map<number | TournamentImageReview, { review: TournamentImageReview; duplicate: boolean }>()
    for (const review of reviews.value) {
      if (review.duplicateAction === 'SKIP') continue
      // Unidentified images remain separate until the administrator supplies a group.
      const key = Number.isInteger(review.groupNumber) && Number(review.groupNumber) > 0 ? review.groupNumber! : review
      selected.set(key, { review, duplicate: selected.has(key) && review.duplicateAction === 'ERROR' })
    }
    return { reviews: [...selected.values()].map(value => value.review), duplicate: [...selected.values()].some(value => value.duplicate) }
  })
  const reviewError = computed(() => {
    if (!config.value) return 'rulesMissing'
    const seen = new Set(dayState.value?.groups.map(group => group.groupNumber) || [])
    for (const review of reviewSelection.value.reviews) {
      const issue = tournamentGroupReviewError(review, config.value, round.value, day.value)
      if (issue) return issue
      if (seen.has(review.groupNumber!) && review.duplicateAction === 'ERROR') return 'duplicate'
      seen.add(review.groupNumber!)
    }
    return reviewSelection.value.duplicate ? 'duplicate' : null
  })
  function draftRequest(): TournamentDraftRequest {
    const current = dayState.value!
    return {
      expectedEventVersion: current.eventVersion,
      expectedDayVersion: current.version,
      expectedRulesVersion: current.rulesVersion,
      groups: reviewSelection.value.reviews.filter(review => review.result).map(review => ({
        groupNumber: review.groupNumber!,
        evidenceId: review.evidenceId,
        imageHash: review.result!.imageHash,
        teams: review.teams.map(team => ({ clanTag: normalizeTournamentClan(team.clanTag), rank: team.rank! })),
        complete: review.complete, duplicateAction: review.duplicateAction,
      })),
      confirmedNewClans: [...new Set(reviewSelection.value.reviews.flatMap(review => review.confirmedClans))],
    }
  }
  async function write(task: (signal: AbortSignal) => Promise<TournamentDayView>, resetReviews = true) {
    if (!allowed.value || busy.value || recognizing.value || stale.value || !dayState.value) return
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true
    error.value = null
    notice.value = ''
    try {
      const value = await task(controller.signal)
      if (!owns(gen, epoch)) return
      applyDay(value)
      if (resetReviews) clearReviews()
      const [cfg, entries] = await Promise.all([transport.getTournamentConfig(eventId.value!, controller.signal), transport.getTournamentAudit(eventId.value!, controller.signal)])
      if (owns(gen, epoch)) { config.value = cfg; audit.value = entries; notice.value = 'saved' }
      return value
    } catch (value) { if (owns(gen, epoch)) fail(value) }
    finally { if (owns(gen, epoch)) busy.value = false }
  }
  async function recognize(files: File[], retry?: TournamentImageReview) {
    if (!canUpload.value) return
    const gen = generation, epoch = auth.authEpoch(), versions = draftRequest()
    recognizing.value = true
    progress.value = 0
    error.value = null
    for (const file of files) {
      if (!owns(gen, epoch)) break
      let review = retry || reviews.value.find(review => review.file === file)
      if (review?.result && !retry) { progress.value++; continue }
      if (!review) {
        review = { file, url: URL.createObjectURL(file), evidenceId: '', result: null, groupNumber: null, teams: [], complete: false, duplicateAction: 'ERROR', confirmedClans: [], error: null }
        reviews.value.push(review)
        review = reviews.value[reviews.value.length - 1]
      }
      review.error = null
      try {
        const recognized = await transport.recognizeTournamentImage(eventId.value!, round.value, day.value, versions, file, controller.signal)
        if (!owns(gen, epoch)) break
        review.result = recognized.result
        review.evidenceId = recognized.evidenceId
        review.groupNumber = recognized.result.groupNumber
        review.teams = recognized.result.teams.map(team => ({ clanTag: team.clanTag, rank: team.rank }))
        review.complete = false
      } catch (value) {
        if (owns(gen, epoch)) { review.error = value; fail(value) }
      }
      progress.value++
    }
    if (owns(gen, epoch)) recognizing.value = false
  }
  function cancelRecognition() {
    generation++
    controller.abort()
    controller = new AbortController()
    recognizing.value = false
  }
  async function preview() {
    if (!editable.value || reviewError.value || !reviews.value.length) return
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true
    error.value = null
    try {
      const value = await transport.previewTournamentDay(eventId.value!, round.value, day.value, draftRequest(), controller.signal)
      if (owns(gen, epoch)) previewState.value = value
    } catch (value) { if (owns(gen, epoch)) fail(value) }
    finally { if (owns(gen, epoch)) busy.value = false }
  }
  function saveDraft() {
    if (!editable.value || reviewError.value) return Promise.resolve(undefined)
    return write(signal => transport.saveTournamentDraft(eventId.value!, round.value, day.value, draftRequest(), signal))
  }
  const canFinalize = computed(() => {
    const candidate = reviews.value.length ? previewState.value : dayState.value
    return editable.value && !reviewError.value && !!candidate?.expectedGroupCount
      && candidate.groups.length === candidate.expectedGroupCount
      && (reviews.value.length > 0 || ['DRAFT', 'CORRECTION'].includes(candidate.status))
  })
  async function finalize() {
    if (!canFinalize.value) return
    // Both visible actions work from a reviewed preview: confirmation first persists the
    // shared draft, then publishes that version. Public results change only on publication.
    if (reviews.value.length && !await saveDraft()) return
    return write(signal => transport.finalizeTournamentDay(eventId.value!, round.value, day.value, {
      expectedEventVersion: dayState.value!.eventVersion, expectedDayVersion: dayState.value!.version,
      expectedRulesVersion: dayState.value!.rulesVersion, idempotencyKey: publicationKey,
    }, signal))
  }
  function setExpected(count: number) {
    if (!editable.value || !Number.isInteger(count) || count < 1 || count > 10000) return Promise.resolve(undefined)
    return write(signal => transport.setTournamentExpectedGroups(eventId.value!, round.value, day.value, {
      expectedEventVersion: dayState.value!.eventVersion, expectedDayVersion: dayState.value!.version, expectedGroupCount: count,
    }, signal), false)
  }
  function correction(count: number, reason: string) {
    if (dayState.value?.status !== 'FINALIZED' || !reason.trim() || !Number.isInteger(count) || count < 1) return Promise.resolve(undefined)
    return write(signal => transport.startTournamentCorrection(eventId.value!, round.value, day.value, {
      expectedEventVersion: dayState.value!.eventVersion, expectedDayVersion: dayState.value!.version,
      expectedGroupCount: count, reason: reason.trim(),
    }, signal))
  }
  function discard() {
    return write(signal => transport.discardTournamentDraft(eventId.value!, round.value, day.value, {
      expectedEventVersion: dayState.value!.eventVersion, expectedDayVersion: dayState.value!.version,
    }, signal))
  }
  async function clearPoints(clanTag: string, scopeDay: number | null, reason: string, restore: boolean) {
    if (!allowed.value || busy.value || recognizing.value || stale.value || !config.value || !reason.trim()) return
    const gen = generation, epoch = auth.authEpoch()
    busy.value = true
    try {
      await transport.clearTournamentPoints(eventId.value!, { expectedEventVersion: config.value.event.version,
        roundNumber: round.value, dayNumber: scopeDay, clanTag, reason: reason.trim(), restore }, controller.signal)
      if (owns(gen, epoch)) await loadSelection()
    } catch (value) { if (owns(gen, epoch)) fail(value) }
    finally { if (owns(gen, epoch)) busy.value = false }
  }
  watch([eventId, round, day, () => (auth.tokenParsed.value as KeycloakTokenParsed | null)?.sub, allowed], () => {
    if (!allowed.value) { invalidate(); config.value = null; dayState.value = null; events.value = []; audit.value = [] }
    else { void loadSelection(); if (!events.value.length) void loadEvents() }
  }, { immediate: true })
  watch(reviews, () => { previewState.value = null }, { deep: true })
  onScopeDispose(() => { invalidate(); events.value = []; audit.value = []; config.value = null; dayState.value = null })
  return { allowed, events, eventId, round, day, config, dayState, previewState, standings, audit, reviews,
    busy, recognizing, progress, error, stale, notice, roundRule, editable, canUpload, canFinalize, reviewError,
    loadEvents, loadSelection, recognize, cancelRecognition, preview, saveDraft, finalize, setExpected, correction, discard, clearPoints }
}
