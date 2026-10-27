<script setup>
/**
 * 火炮射界交互图（BlitzInfo “Gun arcs” 同构）。
 *
 * 俯视、车头朝上：悬停/拖动圆盘 → 该方位角的 Bearing / Up / Down 实时更新；
 * 阴影带 = 炮管在该方位能达到的全部俯仰范围（models.pb pitch_limits，含装备加成）。
 * 指针半径对应一个具体俯仰（Barrel），离开圆盘复位到 0°（鼠标；触屏保留最后值）。
 * 数值语义与 3D 瞄准/回放共用 replay-local/compute 的 pitchAtBearing。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fmtNum } from '../scene/tankMeta.js'
import {
  bearingFromPoint,
  clampBearing,
  gunArcBandPath,
  pitchForRadius,
  radiusForPitch,
} from '../replay-local/compute/gunArc'
import { pitchAtBearing } from '../replay-local/compute/tankSetup'

const props = defineProps({
  /** 当前配置的 pitch_limits（models.pb 的 min/max/front/back/transition） */
  pitchLimits: { type: Object, required: true },
  /** 当前配置的 yaw_limits（null = 全向炮塔） */
  yawLimits: { type: Object, default: null },
  /** 装备加成（improvedPitchLimitsSystem：+4 仰角 / +3 俯角） */
  bonus: { type: Object, default: null },
})

const { t } = useI18n()

const bearing = ref(0)
const barrel = ref(0)

const limits = computed(() => pitchAtBearing(props.pitchLimits, bearing.value, props.bonus))
const bandPath = computed(() => gunArcBandPath(props.pitchLimits, props.yawLimits, props.bonus))
const ringUp = radiusForPitch(10)
const ringDown = radiusForPitch(-10)

const aim = computed(() => {
  const radius = radiusForPitch(barrel.value)
  const rad = bearing.value * Math.PI / 180
  return {
    x: Math.round(radius * Math.sin(rad) * 1e4) / 1e4,
    y: Math.round(-radius * Math.cos(rad) * 1e4) / 1e4,
  }
})

function clampPitch(value) {
  return Math.min(limits.value.up, Math.max(limits.value.down, value))
}

function reset() {
  bearing.value = clampBearing(0, props.yawLimits)
  barrel.value = clampPitch(0)
}

watch(
  () => [props.pitchLimits, props.yawLimits, props.bonus],
  reset,
  { immediate: true, deep: true },
)

/** 屏幕坐标 → SVG 单位坐标（getScreenCTM 不可用时按正方 viewBox 回退）。 */
function localPoint(event) {
  const svg = event.currentTarget
  const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null
  if (ctm && typeof svg.createSVGPoint === 'function' && typeof ctm.inverse === 'function') {
    const point = svg.createSVGPoint()
    if (typeof point.matrixTransform === 'function') {
      point.x = event.clientX
      point.y = event.clientY
      const local = point.matrixTransform(ctm.inverse())
      return { x: local.x, y: local.y }
    }
  }
  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return { x: 0, y: 0 }
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2.04 - 1.02,
    y: ((event.clientY - rect.top) / rect.height) * 2.04 - 1.02,
  }
}

function update(event) {
  const { x, y } = localPoint(event)
  const nextBearing = clampBearing(bearingFromPoint(x, y), props.yawLimits)
  bearing.value = nextBearing
  const nextLimits = pitchAtBearing(props.pitchLimits, nextBearing, props.bonus)
  const radius = Math.min(1, Math.max(0, Math.hypot(x, y)))
  barrel.value = Math.min(
    nextLimits.up,
    Math.max(nextLimits.down, pitchForRadius(radius)),
  )
}

function onLeave(event) {
  // 触屏点按后不应立即复位（pointerleave 在抬手后触发）。
  if (event.pointerType === 'touch') return
  reset()
}

function nudge(delta) {
  bearing.value = clampBearing(bearing.value + delta, props.yawLimits)
  barrel.value = clampPitch(barrel.value)
}

function signed(value) {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0°'
  return `${value > 0 ? '+' : '−'}${fmtNum(Math.abs(value), 1)}°`
}
</script>

<template>
  <figure class="tp-ga" data-testid="tank-gun-arc">
    <figcaption class="tp-ga-head">
      <span class="tp-ga-title">{{ t('agentTanks.params.gun_arcs') }}</span>
      <span class="tp-ga-hint">{{ t('agentTanks.params.gun_arcs_hint') }}</span>
    </figcaption>
    <div class="tp-ga-plot">
      <svg
        class="tp-ga-svg"
        viewBox="-1.02 -1.02 2.04 2.04"
        role="img"
        tabindex="0"
        :aria-label="`${t('agentTanks.params.gun_arcs')}: ${t('agentTanks.params.bearing')} ${signed(bearing)}, ${t('agentTanks.params.arc_up')} ${signed(limits.up)}, ${t('agentTanks.params.arc_down')} ${signed(limits.down)}`"
        @pointermove="update"
        @pointerdown="update"
        @pointerleave="onLeave"
        @keydown.left.prevent="nudge(-5)"
        @keydown.right.prevent="nudge(5)"
        @keydown.home.prevent="reset"
      >
        <circle class="tp-ga-disc" r="1" />
        <circle class="tp-ga-ring" :r="ringUp" />
        <text class="tp-ga-ring-label" :x="ringUp + 0.014" y="-0.012" font-size="0.07">+10°</text>
        <circle class="tp-ga-ring" :r="ringDown" />
        <text class="tp-ga-ring-label" :x="ringDown + 0.014" y="-0.012" font-size="0.07">−10°</text>
        <circle class="tp-ga-horizon" r="0.5" />
        <path class="tp-ga-band" :d="bandPath" fill-rule="evenodd" />
        <g class="tp-ga-hull">
          <rect x="-0.13" y="-0.2" width="0.26" height="0.4" rx="0.04" />
          <line x1="-0.13" y1="-0.16" x2="-0.13" y2="0.16" />
          <line x1="0.13" y1="-0.16" x2="0.13" y2="0.16" />
          <circle cx="0" cy="-0.02" r="0.075" />
        </g>
        <text class="tp-ga-bow" x="0" y="-0.9" font-size="0.08">{{ t('agentTanks.params.bow') }}</text>
        <line class="tp-ga-aim-line" x1="0" y1="0" :x2="aim.x" :y2="aim.y" />
        <circle class="tp-ga-aim-dot" r="0.028" :cx="aim.x" :cy="aim.y" />
      </svg>
      <span class="tp-ga-stat is-tl" data-testid="tank-arc-barrel">
        <em>{{ t('agentTanks.params.arc_barrel') }}</em>{{ signed(barrel) }}
      </span>
      <span class="tp-ga-stat is-tr" data-testid="tank-arc-bearing">
        <em>{{ t('agentTanks.params.bearing') }}</em>{{ signed(bearing) }}
      </span>
      <span class="tp-ga-stat is-bl" data-testid="tank-arc-up">
        <em>{{ t('agentTanks.params.arc_up') }}</em>{{ signed(limits.up) }}
      </span>
      <span class="tp-ga-stat is-br" data-testid="tank-arc-down">
        <em>{{ t('agentTanks.params.arc_down') }}</em>{{ signed(limits.down) }}
      </span>
    </div>
  </figure>
</template>

<style scoped>
.tp-ga { display: grid; gap: var(--space-1); margin: 0; padding-block-start: var(--space-2); border-block-start: 1px solid var(--color-border-subtle); }
.tp-ga-head { display: grid; gap: 1px; }
.tp-ga-title { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.tp-ga-hint { color: var(--color-text-secondary); font: var(--type-caption); }

.tp-ga-plot { position: relative; inline-size: 100%; max-inline-size: 300px; margin-inline: auto; aspect-ratio: 1; }
.tp-ga-svg { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; overflow: visible; cursor: crosshair; touch-action: none; outline: none; }
.tp-ga-svg:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); border-radius: var(--radius-full); }

.tp-ga-disc { fill: var(--color-surface-1); stroke: var(--color-border-subtle); stroke-width: 0.006; }
.tp-ga-ring { fill: none; stroke: var(--color-border-subtle); stroke-width: 0.004; }
.tp-ga-horizon { fill: none; stroke: var(--color-border-strong); stroke-width: 0.006; stroke-dasharray: 0.03 0.03; }
.tp-ga-ring-label { fill: var(--color-text-secondary); font-family: var(--font-family-sans); font-weight: 400; }
.tp-ga-band {
  fill: color-mix(in oklab, var(--color-accent) 22%, transparent);
  stroke: color-mix(in oklab, var(--color-accent) 45%, transparent);
  stroke-width: 0.006;
}
.tp-ga-hull { fill: var(--color-surface-2); stroke: var(--color-text-secondary); stroke-width: 0.008; }
.tp-ga-bow { fill: var(--color-text-secondary); font-family: var(--font-family-sans); font-weight: 400; text-anchor: middle; letter-spacing: 0.02em; }
.tp-ga-aim-line { stroke: var(--color-text-primary); stroke-width: 0.006; opacity: 0.55; }
.tp-ga-aim-dot { fill: var(--color-accent); stroke: var(--color-surface-1); stroke-width: 0.008; }

.tp-ga-stat {
  position: absolute;
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  color: var(--color-text-primary);
  font: var(--type-caption);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.tp-ga-stat em { color: var(--color-text-secondary); font-style: normal; font-weight: 400; }
.tp-ga-stat.is-tl { inset-block-start: 0; inset-inline-start: 0; }
.tp-ga-stat.is-tr { inset-block-start: 0; inset-inline-end: 0; }
.tp-ga-stat.is-bl { inset-block-end: 0; inset-inline-start: 0; }
.tp-ga-stat.is-br { inset-block-end: 0; inset-inline-end: 0; }
</style>
