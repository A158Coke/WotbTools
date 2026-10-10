<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { ArrowRight, BookOpen, Check, Compass, X } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'
import { ONBOARDING_GUIDES, ONBOARDING_TOPICS } from '../composables/useOnboarding.js'
import type { GuideStage, OnboardingController } from '../composables/useOnboarding.js'
import { guideCardPosition, guideCutout, guideMasks } from '../utils/onboardingGeometry.js'
import type { GuideRect } from '../utils/onboardingGeometry.js'
import type { OnboardingTopic } from '../shared/onboarding.js'

const props = defineProps<{ onboarding: OnboardingController }>()
const { mode, topic, index, issue, currentStage, steps, hasFiles, hintVisible, canResume, isSignedIn } = props.onboarding
const inline = inject(DIALOG_INLINE_KEY, false)
// Reuse AppDialog inside the active fullscreen host, instead of teleporting beyond fullscreen.
provide(DIALOG_INLINE_KEY, true)
const teleportTarget = shallowRef<Element | string>('body')
const card = ref<HTMLElement | null>(null)
const target = shallowRef<HTMLElement | null>(null)
const targetScope = shallowRef<HTMLElement | null>(null)
const interactionTargets = shallowRef<HTMLElement[]>([])
const controlledTargets = shallowRef<HTMLElement[]>([])
const suspended = ref(false)
const cutout = ref<GuideRect | null>(null)
const highlight = ref<GuideRect | null>(null)
const viewport = ref<GuideRect>({ left: 0, top: 0, width: 0, height: 0 })
const cardPosition = ref({ left: 0, top: 0, width: 0, maxHeight: 0 })
const compact = ref(false)
const inspectingShot = ref(false)
const navigationStyle = computed(() => inspectingShot.value && !compact.value ? { left: `${cardPosition.value.left}px`, right: 'auto' } : undefined)
const masks = computed(() => guideMasks(cutout.value, viewport.value))
const missingTarget = computed(() => !target.value && issue.value !== 'loading')
const needsReplay = computed(() => steps.value.some(step => step.capability))
const followUpTopics: OnboardingTopic[] = ['tankopedia', 'hof', 'ai', 'tournament', 'shots']
function requiresFullscreenExit(direction: 'next' | 'back') {
  const destination = steps.value[index.value + (direction === 'next' ? 1 : -1)]
  const current = steps.value[index.value]
  return teleportTarget.value !== 'body' && !!destination
    && (current?.capability !== destination.capability || current?.view !== destination.view)
}
const exitBeforeNext = computed(() => requiresFullscreenExit('next'))
const exitBeforeBack = computed(() => requiresFullscreenExit('back'))
const fullscreenExitError = ref(false)
let frame = 0
let releaseFrame = 0
const cardPointers = new Set<number>()
const cardGesture = shallowRef<{ index: number; stage: GuideStage | undefined; issue: string; missing: boolean } | null>(null)
const renderedIndex = computed(() => cardGesture.value?.index ?? index.value)
const renderedStage = computed(() => cardGesture.value?.stage ?? currentStage.value)
const inlineNavigation = computed(() => renderedStage.value?.anchor === 'armor-workspace')
const renderedIssue = computed(() => cardGesture.value?.issue ?? issue.value)
const renderedMissing = computed(() => cardGesture.value?.missing ?? missingTarget.value)
const renderedStages = computed(() => steps.value[renderedIndex.value]?.stages || [])
const renderedStageIndex = computed(() => renderedStages.value.indexOf(renderedStage.value!))
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let opener: HTMLElement | null = null
let scrollAnchor = ''
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function styleRect(rect: GuideRect) {
  return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }
}
const cardStyle = computed(() => ({ left: `${cardPosition.value.left}px`, top: `${cardPosition.value.top}px`, width: `${cardPosition.value.width}px`, maxHeight: `${cardPosition.value.maxHeight}px` }))

function visible(element: HTMLElement) {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    && !element.closest('[hidden], [aria-hidden="true"]')
}

function measure() {
  frame = 0
  if (mode.value !== 'tour') return
  if (cardGesture.value) return
  const visual = window.visualViewport
  viewport.value = { left: visual?.offsetLeft || 0, top: visual?.offsetTop || 0,
    width: visual?.width || window.innerWidth, height: visual?.height || window.innerHeight }
  compact.value = window.matchMedia(PLAYBACK_MOBILE_QUERY).matches
  const root = document.fullscreenElement || document.body
  const anchor = currentStage.value?.anchor
  const found = anchor ? [...root.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)].find(visible) || null : null
  const interactionAnchor = currentStage.value?.interactionAnchor
  interactionTargets.value = interactionAnchor ? [...root.querySelectorAll<HTMLElement>(`[data-tour="${interactionAnchor}"]`)].filter(visible) : []
  const controllers = [found, ...found?.querySelectorAll<HTMLElement>('[aria-controls]') || []].filter((element): element is HTMLElement => !!element)
  controlledTargets.value = controllers.flatMap(element => (element.getAttribute('aria-controls') || '').split(/\s+/))
    .map(id => document.getElementById(id)).filter((element): element is HTMLElement => !!element && visible(element))
  targetScope.value = found?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]') || found
  suspended.value = [...root.querySelectorAll<HTMLElement>('.dialog-scrim, [role="dialog"][aria-modal="true"]')]
    .some(dialog => !dialog.closest('.onboarding-host') && dialog !== targetScope.value && !dialog.contains(found) && visible(dialog))
  if (suspended.value) return
  if (target.value !== found) {
    target.value = found
    resizeObserver?.disconnect()
    if (found) resizeObserver?.observe(found)
    if (card.value) resizeObserver?.observe(card.value)
  }
  if (found && scrollAnchor !== anchor) {
    scrollAnchor = anchor || ''
    found.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
  }
  const tokens = getComputedStyle(document.documentElement)
  const padding = parseFloat(tokens.getPropertyValue('--space-2')) || 8
  const gap = parseFloat(tokens.getPropertyValue('--space-3')) || 12
  const cardWidth = parseFloat(tokens.getPropertyValue('--onboarding-card-width')) || 360
  highlight.value = found ? guideCutout(found.getBoundingClientRect(), viewport.value, padding) : null
  const regions = [targetScope.value, ...interactionTargets.value, ...controlledTargets.value, ...found?.querySelectorAll<HTMLElement>('[role="menu"], [role="listbox"]') || []].filter((element): element is HTMLElement => !!element && visible(element)).map(element => element.getBoundingClientRect())
  const left = Math.min(...regions.map(rect => rect.left)), top = Math.min(...regions.map(rect => rect.top))
  const right = Math.max(...regions.map(rect => rect.right)), bottom = Math.max(...regions.map(rect => rect.bottom))
  cutout.value = regions.length ? guideCutout({ left, top, width: right - left, height: bottom - top }, viewport.value, padding) : null
  const measuredCard = card.value?.getBoundingClientRect()
  // Use intrinsic scroll height: feeding the previous max-height back into placement can move
  // a short phone card between pointerdown and pointerup as ResizeObserver fires.
  const naturalHeight = card.value ? Math.max(card.value.scrollHeight + card.value.offsetHeight - card.value.clientHeight, measuredCard?.height || 0) : 0
  const navigation = card.value?.querySelector('.onboarding-card-actions')?.getBoundingClientRect()
  const cardViewport = { ...viewport.value }
  if (navigation && !inlineNavigation.value && document.fullscreenElement) {
    cardViewport.top = Math.min(viewport.value.top + viewport.value.height, Math.max(viewport.value.top, navigation.bottom))
    cardViewport.height = viewport.value.top + viewport.value.height - cardViewport.top
  } else if (navigation && !inlineNavigation.value) cardViewport.height = Math.max(0, Math.min(viewport.value.height, navigation.top - viewport.value.top))
  const inspector = interactionTargets.value.find(element => element.dataset.tour === 'shots-inspector')
  inspectingShot.value = !!inspector
  if (inspector && (compact.value || inspector.getAttribute('aria-modal') === 'true')) {
    // The real pane owns the inset; leave its contents scrollable above the compact guide.
    const height = Math.min(naturalHeight || 220, cardViewport.height / 2)
    const position = guideCardPosition(null, cardViewport, { width: cardWidth, height }, gap, true)
    cardPosition.value = { ...position, maxHeight: height }
    props.onboarding.reserveShotGuideSpace(viewport.value.top + viewport.value.height - position.top + gap)
  } else {
    props.onboarding.reserveShotGuideSpace(0)
    const avoid = inspector ? guideCutout(inspector.getBoundingClientRect(), viewport.value, padding) : highlight.value
    cardPosition.value = guideCardPosition(avoid, cardViewport, { width: cardWidth, height: naturalHeight || 220 }, gap, compact.value)
  }
}

function scheduleMeasure() {
  if (cardGesture.value) return
  if (!frame && mode.value === 'tour') frame = requestAnimationFrame(measure)
}
function updateFullscreen() {
  fullscreenExitError.value = false
  teleportTarget.value = document.fullscreenElement || 'body'
  scheduleMeasure()
}
async function changeStep(direction: 'next' | 'back') {
  if (mode.value !== 'tour') return
  const fromIndex = index.value, fromTopic = topic.value, fromStage = currentStage.value
  const stillCurrent = () => mode.value === 'tour' && index.value === fromIndex && topic.value === fromTopic && currentStage.value === fromStage
  fullscreenExitError.value = false
  if (requiresFullscreenExit(direction) && document.fullscreenElement) {
    try { await document.exitFullscreen() } catch { if (stillCurrent()) fullscreenExitError.value = true; return }
  }
  if (stillCurrent()) props.onboarding[direction]()
}
function allowedTarget(eventTarget: EventTarget | null) {
  return eventTarget instanceof Node && (card.value?.contains(eventTarget) || targetScope.value?.contains(eventTarget)
    || interactionTargets.value.some(element => element.contains(eventTarget)) || controlledTargets.value.some(element => element.contains(eventTarget)))
}
function restrictPointer(event: Event) {
  if (mode.value !== 'tour' || suspended.value || allowedTarget(event.target)) return
  event.preventDefault()
  event.stopImmediatePropagation()
}
function onPointerDown(event: PointerEvent) {
  if (mode.value === 'tour' && !suspended.value && event.target instanceof Node && card.value?.contains(event.target)) {
    if (!cardGesture.value) cardGesture.value = { index: index.value, stage: currentStage.value, issue: issue.value, missing: missingTarget.value }
    cardPointers.add(event.pointerId)
    cancelAnimationFrame(frame)
    frame = 0
  }
  restrictPointer(event)
}
function onPointerEnd(event: PointerEvent) {
  cardPointers.delete(event.pointerId)
  if (!cardPointers.size && cardGesture.value && !releaseFrame) {
    // Freeze content as well as placement: removing a loading paragraph would otherwise move
    // the footer under a held finger. Release after the native compatibility click, never emit one.
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = 0
      if (cardPointers.size) return
      cardGesture.value = null
      void nextTick().then(scheduleMeasure)
    })
  }
}
function focusables() {
  const candidates: HTMLElement[] = []
  if (targetScope.value?.matches(FOCUSABLE)) candidates.push(targetScope.value)
  candidates.push(...targetScope.value?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])
  for (const interaction of interactionTargets.value) {
    if (interaction.matches(FOCUSABLE)) candidates.push(interaction)
    candidates.push(...interaction.querySelectorAll<HTMLElement>(FOCUSABLE))
  }
  for (const controlled of controlledTargets.value) {
    if (controlled.matches(FOCUSABLE)) candidates.push(controlled)
    candidates.push(...controlled.querySelectorAll<HTMLElement>(FOCUSABLE))
  }
  candidates.push(...card.value?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])
  return [...new Set(candidates)].filter(visible)
}
function onKeydown(event: KeyboardEvent) {
  if (mode.value !== 'tour' || suspended.value) return
  if (event.key === 'Escape') {
    // A real target dialog owns Escape for events originating inside it.
    if (event.target instanceof Element && !card.value?.contains(event.target)
      && allowedTarget(event.target) && event.target.closest('[role="dialog"]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    props.onboarding.skip()
  } else if (event.key === 'Tab') {
    const items = focusables()
    const active = items.indexOf(document.activeElement as HTMLElement)
    event.preventDefault()
    const next = active < 0 ? (event.shiftKey ? items.length - 1 : 0) : (active + (event.shiftKey ? -1 : 1) + items.length) % items.length
    ;(items[next] || card.value)?.focus()
  } else if (event.target instanceof Node && (card.value?.contains(event.target) || !allowedTarget(event.target))) {
    // Keep the focused guide's Space/arrow/H keys from controlling the background replay.
    // Default button activation and scrolling still work; real target input keeps its normal keys.
    event.stopImmediatePropagation()
  }
}

function detach() {
  props.onboarding.reserveShotGuideSpace(0)
  cancelAnimationFrame(frame)
  cancelAnimationFrame(releaseFrame)
  frame = 0
  releaseFrame = 0
  cardPointers.clear()
  cardGesture.value = null
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  resizeObserver = null
  mutationObserver = null
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('pointerup', onPointerEnd, true)
  document.removeEventListener('pointercancel', onPointerEnd, true)
  document.removeEventListener('click', restrictPointer, true)
  document.removeEventListener('scroll', scheduleMeasure, true)
  window.removeEventListener('resize', scheduleMeasure)
  window.visualViewport?.removeEventListener('resize', scheduleMeasure)
  window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
  target.value = null
  targetScope.value = null
  interactionTargets.value = []
  controlledTargets.value = []
  cutout.value = null
  highlight.value = null
}

watch(mode, async (value, previous) => {
  if (previous === 'tour') {
    detach()
    if (opener?.isConnected) opener.focus()
    opener = null
  }
  if (value !== 'tour') return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  scrollAnchor = ''
  await nextTick()
  if (mode.value !== 'tour') return
  if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(scheduleMeasure)
  mutationObserver = new MutationObserver(records => {
    // Geometry writes belong to this host; observing them would schedule another geometry write.
    if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.onboarding-host'))) scheduleMeasure()
  })
  mutationObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-tour'] })
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointerup', onPointerEnd, true)
  document.addEventListener('pointercancel', onPointerEnd, true)
  document.addEventListener('click', restrictPointer, true)
  document.addEventListener('scroll', scheduleMeasure, true)
  window.addEventListener('resize', scheduleMeasure)
  window.visualViewport?.addEventListener('resize', scheduleMeasure)
  window.visualViewport?.addEventListener('scroll', scheduleMeasure)
  measure()
  card.value?.focus()
}, { immediate: true })
watch(currentStage, async () => { scrollAnchor = ''; await nextTick(); scheduleMeasure() })
watch(issue, async () => { await nextTick(); scheduleMeasure() })
onMounted(() => { updateFullscreen(); document.addEventListener('fullscreenchange', updateFullscreen) })
onBeforeUnmount(() => { detach(); document.removeEventListener('fullscreenchange', updateFullscreen) })
</script>

<template>
  <Teleport :to="teleportTarget" :disabled="inline">
    <div class="onboarding-host" data-testid="onboarding-host">
      <aside v-if="hintVisible && mode === 'idle'" class="onboarding-available" role="status" data-testid="onboarding-available">
        <BookOpen :size="18" aria-hidden="true" /><span>{{ $t('onboarding.availableHint') }}</span>
        <AppButton size="sm" @click="onboarding.start()">{{ $t('onboarding.viewGuide') }}</AppButton>
        <button class="onboarding-close" type="button" :aria-label="$t('app.close')" @click="onboarding.dismissHint"><X :size="18" aria-hidden="true" /></button>
      </aside>
      <AppDialog
        :open="mode === 'welcome'"
        :title="topic === 'core' ? $t('onboarding.welcomeTitle') : $t(`onboarding.topics.${topic}.title`)"
        size="sm"
        data-testid="onboarding-welcome"
        @close="onboarding.skip"
      >
        <div class="onboarding-intro-icon"><Compass :size="28" aria-hidden="true" /></div>
        <p>{{ topic === 'core' ? $t('onboarding.welcomeDescription') : $t(`onboarding.topics.${topic}.description`) }}</p>
        <p class="onboarding-note">{{ $t(isSignedIn ? 'onboarding.welcomeHint' : 'onboarding.anonymousHint') }}</p>
        <p v-if="topic === 'ai'" class="onboarding-note">{{ $t('onboarding.aiLoginRequired') }}</p>
        <p v-if="needsReplay && hasFiles" class="onboarding-note">{{ $t('onboarding.replaceWarning') }}</p>
        <template #actions>
          <AppButton variant="ghost" data-testid="onboarding-skip-welcome" @click="onboarding.skip">{{ $t('onboarding.later') }}</AppButton>
          <AppButton v-if="canResume" variant="primary" data-testid="onboarding-resume" @click="onboarding.resume">{{ $t('onboarding.resume') }}</AppButton>
          <AppButton v-if="topic === 'ai' && !isSignedIn" variant="primary" data-testid="onboarding-ai-login" @click="onboarding.loginAiGuide">{{ $t('app.login') }}</AppButton>
          <AppButton v-else :variant="canResume ? 'secondary' : 'primary'" data-testid="onboarding-begin" @click="onboarding.begin()">
            {{ needsReplay ? $t(hasFiles ? 'onboarding.replaceDemo' : 'onboarding.tryDemo') : $t('onboarding.begin') }}
            <ArrowRight :size="16" aria-hidden="true" />
          </AppButton>
        </template>
      </AppDialog>

      <div v-if="mode === 'tour' && !suspended" class="onboarding-layer" :class="{ 'is-fullscreen': teleportTarget !== 'body' }" data-testid="onboarding-layer">
        <div v-for="(mask, number) in masks" :key="number" class="onboarding-mask" :style="styleRect(mask)" aria-hidden="true" />
        <div v-if="highlight" class="onboarding-cutout" :style="styleRect(highlight)" data-testid="onboarding-cutout" aria-hidden="true" />
        <section
          ref="card"
          class="onboarding-card"
          :class="{ 'is-compact': compact }"
          :style="cardStyle"
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-step-title"
          aria-describedby="onboarding-step-description"
          tabindex="-1"
          data-testid="onboarding-card"
          :data-step="index + 1"
          :data-anchor="renderedStage?.anchor"
        >
          <header class="onboarding-card-head">
            <span class="onboarding-progress">{{ $t(topic === 'core' ? 'onboarding.mainGuide' : 'onboarding.sideGuide') }} · {{ $t('onboarding.progress', { current: renderedIndex + 1, total: steps.length }) }}<small v-if="renderedStages.length > 1"> · {{ $t('onboarding.stageProgress', { current: renderedStageIndex + 1, total: renderedStages.length }) }}</small></span>
            <button class="onboarding-close" type="button" :aria-label="$t('onboarding.skip')" data-testid="onboarding-skip" @click="onboarding.skip"><X :size="18" aria-hidden="true" /></button>
          </header>
          <div class="onboarding-meter" aria-hidden="true"><span :style="{ width: `${(renderedIndex + 1) / steps.length * 100}%` }" /></div>
          <h2 id="onboarding-step-title">{{ $t(`onboarding.steps.${renderedStage?.copy}.title`) }}</h2>
          <p id="onboarding-step-description">{{ $t(`onboarding.steps.${renderedStage?.copy}.description`) }}</p>
          <p v-if="fullscreenExitError || renderedIssue || renderedMissing" class="onboarding-status" role="status">
            {{ $t(fullscreenExitError ? 'onboarding.exitFullscreenFailed' : renderedIssue === 'loading' ? 'onboarding.loading' : renderedIssue === 'unavailable' ? 'onboarding.unavailable' : 'onboarding.missingTarget') }}
          </p>
          <div class="onboarding-card-actions" :class="{ 'is-in-card': inlineNavigation }" :style="navigationStyle">
            <AppButton variant="ghost" :disabled="renderedIndex === 0" data-testid="onboarding-back" @click="changeStep('back')">{{ $t(exitBeforeBack ? 'onboarding.exitFullscreenBack' : 'onboarding.back') }}</AppButton>
            <AppButton v-if="renderedIssue === 'unavailable' || renderedMissing" variant="secondary" data-testid="onboarding-retry" @click="onboarding.retry">{{ $t('onboarding.retry') }}</AppButton>
            <AppButton variant="primary" data-testid="onboarding-next" @click="changeStep('next')">{{ $t(exitBeforeNext ? 'onboarding.exitFullscreenNext' : renderedIndex === steps.length - 1 ? 'onboarding.finish' : 'onboarding.next') }}<ArrowRight :size="16" aria-hidden="true" /></AppButton>
          </div>
          <p class="onboarding-card-hint">{{ $t('onboarding.optionalAction') }}</p>
        </section>
      </div>

      <AppDialog :open="mode === 'finish'" :title="$t(topic === 'core' ? 'onboarding.mainFinishedTitle' : 'onboarding.finishedTitle')" size="sm" data-testid="onboarding-finish" @close="onboarding.interrupt">
        <div class="onboarding-intro-icon"><Check :size="28" aria-hidden="true" /></div>
        <p>{{ $t(isSignedIn ? 'onboarding.finishedDescription' : 'onboarding.anonymousFinished') }}</p>
        <section v-if="topic === 'core'" class="onboarding-follow-ups" data-testid="onboarding-follow-ups" aria-labelledby="onboarding-follow-ups-title">
          <h3 id="onboarding-follow-ups-title">{{ $t('onboarding.sideGuide') }}</h3>
          <p class="onboarding-note">{{ $t('onboarding.followUpDescription') }}</p>
          <div class="onboarding-follow-up-grid">
            <button v-for="guide in followUpTopics" :key="guide" class="onboarding-topic" type="button" :data-testid="`onboarding-follow-up-${guide}`" @click="onboarding.start(guide)">
              <strong>{{ $t(`onboarding.topics.${guide}.title`) }}</strong>
              <small>{{ $t(guide === 'ai' ? 'onboarding.aiLoginRequired' : 'onboarding.topicSteps', { count: ONBOARDING_GUIDES[guide].length }) }}</small>
            </button>
          </div>
        </section>
        <template #actions>
          <AppButton data-testid="onboarding-finish-directory" @click="onboarding.openDirectory"><BookOpen :size="16" aria-hidden="true" />{{ $t('onboarding.directory') }}</AppButton>
          <AppButton data-testid="onboarding-explore" @click="onboarding.interrupt">{{ $t('onboarding.explore') }}</AppButton>
          <AppButton variant="primary" data-testid="onboarding-own-replay" @click="onboarding.useOwnReplay">{{ $t('onboarding.ownReplay') }}</AppButton>
        </template>
      </AppDialog>

      <AppDialog :open="mode === 'directory'" :title="$t('onboarding.directory')" size="lg" data-testid="onboarding-directory" @close="onboarding.interrupt">
        <p>{{ $t('onboarding.directoryDescription') }}</p>
        <h3>{{ $t('onboarding.mainGuide') }}</h3>
        <AppButton variant="primary" class="onboarding-core-link" data-testid="onboarding-restart" @click="onboarding.start()"><Compass :size="18" aria-hidden="true" />{{ $t('onboarding.restart') }}</AppButton>
        <h3>{{ $t('onboarding.sideGuide') }}</h3>
        <div class="onboarding-directory-grid">
          <button v-for="guide in ONBOARDING_TOPICS" :key="guide" class="onboarding-topic" type="button" :data-testid="`onboarding-topic-${guide}`" @click="onboarding.start(guide)">
            <strong>{{ $t(`onboarding.topics.${guide}.title`) }}</strong>
            <span>{{ $t(`onboarding.topics.${guide}.description`) }}</span>
            <small>{{ $t('onboarding.topicSteps', { count: ONBOARDING_GUIDES[guide].length }) }}</small>
            <small v-if="guide === 'ai'">{{ $t('onboarding.aiLoginRequired') }}</small>
          </button>
        </div>
      </AppDialog>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-host { color: var(--color-text-primary); }
.onboarding-available { position: fixed; inset-block-start: calc(var(--header-h) + var(--space-3)); inset-inline-end: var(--space-3); z-index: var(--z-menu); display: flex; align-items: center; gap: var(--space-2); max-width: calc(100dvw - var(--sidebar-w) - var(--space-6)); padding: var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-1); box-shadow: var(--elevation-2); font: var(--type-caption); }
.onboarding-available > span { min-width: 0; overflow-wrap: anywhere; }
.onboarding-layer { position: fixed; inset: 0; z-index: var(--z-dialog); pointer-events: none; }
.onboarding-mask { position: fixed; background: var(--color-onboarding-scrim); pointer-events: none; }
.onboarding-cutout { position: fixed; border: var(--onboarding-outline); border-radius: var(--radius-md); box-shadow: var(--elevation-3); pointer-events: none; }
.onboarding-card { position: fixed; display: flex; flex-direction: column; gap: var(--space-2); max-height: calc(100dvh - var(--space-6)); overflow-y: auto; padding: var(--space-4); border: 1px solid var(--color-border-strong); border-radius: var(--radius-lg); background: var(--color-surface-1); box-shadow: var(--elevation-3); pointer-events: auto; outline: 0; }
.onboarding-card > * { flex-shrink: 0; }
.onboarding-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.onboarding-progress { color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.onboarding-close { display: grid; place-items: center; min-width: var(--control-h-md); min-height: var(--control-h-md); padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.onboarding-close:focus-visible, .onboarding-topic:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.onboarding-card .onboarding-close { position: fixed; inset-block-start: max(var(--space-3), env(safe-area-inset-top)); inset-inline-end: max(var(--space-3), env(safe-area-inset-right)); border: 1px solid var(--color-border-subtle); background: var(--color-surface-1); }
.onboarding-meter { height: var(--space-1); overflow: hidden; border-radius: var(--radius-full); background: var(--color-surface-3); }
.onboarding-meter > span { display: block; height: 100%; background: var(--color-accent); transition: width var(--duration-base) var(--ease-standard); }
.onboarding-card h2 { margin: var(--space-1) 0 0; font: var(--type-h3); }
.onboarding-card p { margin: 0; color: var(--color-text-secondary); font: var(--type-body); overflow-wrap: anywhere; }
.onboarding-card .onboarding-status { padding: var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-text-primary); }
.onboarding-card-actions { position: fixed; inset-block-end: max(var(--space-3), env(safe-area-inset-bottom)); inset-inline-end: max(var(--space-3), env(safe-area-inset-right)); display: flex; align-items: center; justify-content: flex-end; flex-wrap: nowrap; gap: var(--space-2); width: min(var(--onboarding-card-width), calc(100dvw - var(--space-6))); padding: var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); box-shadow: var(--elevation-2); }
.onboarding-card-actions > * { min-width: 0; flex-shrink: 1; white-space: normal; }
.onboarding-card-actions.is-in-card { position: static; width: 100%; box-shadow: none; }
.onboarding-layer.is-fullscreen .onboarding-card-actions { inset-block-end: auto; inset-block-start: calc(max(var(--space-3), env(safe-area-inset-top)) + var(--control-h-md) + var(--space-2)); }
.onboarding-card .onboarding-card-hint { font: var(--type-caption); }
.onboarding-intro-icon { display: inline-grid; place-items: center; width: var(--space-12); height: var(--space-12); margin-bottom: var(--space-3); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-accent-text); }
.onboarding-note { font: var(--type-caption); }
.onboarding-core-link { margin-block: var(--space-2) var(--space-4); }
.onboarding-directory-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.onboarding-follow-up-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
.onboarding-follow-ups { margin-block-start: var(--space-4); }
.onboarding-follow-up-grid .onboarding-topic { gap: var(--space-1); padding: var(--space-3); }
.onboarding-follow-up-grid .onboarding-topic strong { font: var(--type-body); font-weight: 600; }
.onboarding-topic { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-4); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-body); text-align: start; overflow-wrap: anywhere; cursor: pointer; }
.onboarding-topic strong { font: var(--type-h3); }
.onboarding-topic span { color: var(--color-text-secondary); }
.onboarding-topic small { color: var(--color-accent-text); font: var(--type-caption); }
@media (hover: hover) { .onboarding-topic:hover, .onboarding-close:hover { background: var(--color-surface-2); } }
@media (width < 768px) { .onboarding-directory-grid { grid-template-columns: minmax(0, 1fr); } }
.onboarding-card.is-compact { padding-bottom: max(var(--space-4), env(safe-area-inset-bottom)); }
</style>
