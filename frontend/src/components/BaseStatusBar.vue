<script setup>
// 基地状态条（2D / 3D 回放共用）：每个基地一枚圆形徽章——底色 = 当前归属（友绿 / 敌红 / 中立白），
// 外圈进度环 = 占领进度，颜色跟占领方；单基地（攻防 / 遭遇战）协议不给占领方，徽章放旗帜图标、
// 进度环用目标色，旁边显示百分比。两端可选显示争霸积分。
// 输入是 utils/baseStatus.js 的视图模型（baseView），本组件不做任何协议推断。
import { useI18n } from 'vue-i18n'
import { Flag } from 'lucide-vue-next'

defineOptions({ name: 'BaseStatusBar' })

const props = defineProps({
  /** [{ baseId, kind: 'supremacy'|'assault', owner, capturing, progress }] */
  bases: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
  friendlyPoints: { type: Number, default: null },
  enemyPoints: { type: Number, default: null },
})

const { t } = useI18n()

const RADIUS = 14
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function ringDash(progress) {
  const filled = (Math.max(0, Math.min(100, progress)) / 100) * CIRCUMFERENCE
  return `${filled} ${CIRCUMFERENCE}`
}

function showRing(base) {
  return base.progress != null && (base.kind === 'assault' || base.capturing != null)
}

function baseLabel(base) {
  if (base.kind === 'assault') {
    const state = base.progress == null
      ? t('baseStatus.objective_idle')
      : t('baseStatus.objective_progress', { progress: Math.round(base.progress) })
    return `${t('baseStatus.objective')}：${state}`
  }
  const owner = t(`baseStatus.owner_${base.owner}`)
  if (!showRing(base)) return `${base.baseId}：${owner}`
  return `${base.baseId}：${owner}，${t(`baseStatus.capturing_${base.capturing}`, { progress: Math.round(base.progress) })}`
}
</script>

<template>
  <div v-if="props.bases.length" class="base-status-bar" :class="{ 'is-compact': props.compact }" role="group" :aria-label="t('baseStatus.title')" data-testid="base-status-bar">
    <span
      v-if="props.friendlyPoints != null"
      class="base-points base-points-friendly"
      data-testid="base-points-friendly"
      :aria-label="t('baseStatus.points_friendly', { points: Math.round(props.friendlyPoints) })"
    >{{ Math.round(props.friendlyPoints) }}</span>

    <span
      v-for="base in props.bases"
      :key="base.baseId"
      class="base-badge"
      :class="[`is-owner-${base.owner}`, base.capturing ? `is-capturing-${base.capturing}` : '', `is-${base.kind}`]"
      role="img"
      :aria-label="baseLabel(base)"
      :title="baseLabel(base)"
      :data-testid="`base-badge-${base.baseId}`"
    >
      <span class="base-badge-core">
      <svg class="base-badge-svg" viewBox="-17 -17 34 34" aria-hidden="true">
        <circle class="base-badge-track" :r="RADIUS" />
        <circle
          v-if="showRing(base)"
          class="base-badge-ring"
          :r="RADIUS"
          :stroke-dasharray="ringDash(base.progress)"
          transform="rotate(-90)"
          data-testid="base-badge-ring"
        />
        <circle class="base-badge-fill" r="11" />
        <text v-if="base.kind === 'supremacy'" class="base-badge-letter" y="0.5">{{ base.baseId }}</text>
      </svg>
      <Flag v-if="base.kind === 'assault'" class="base-badge-flag" :size="13" aria-hidden="true" />
      </span>
      <span v-if="base.kind === 'assault' && base.progress != null" class="base-objective-progress">{{ Math.round(base.progress) }}%</span>
    </span>

    <span
      v-if="props.enemyPoints != null"
      class="base-points base-points-enemy"
      data-testid="base-points-enemy"
      :aria-label="t('baseStatus.points_enemy', { points: Math.round(props.enemyPoints) })"
    >{{ Math.round(props.enemyPoints) }}</span>
  </div>
</template>

<style scoped>
.base-status-bar {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  background: color-mix(in oklab, var(--color-canvas) 82%, transparent);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}

.base-points { font: var(--type-caption); font-weight: 700; font-variant-numeric: tabular-nums; }
.base-points-friendly { color: var(--color-team-ally); }
.base-points-enemy { color: var(--color-team-enemy); }

.base-badge { display: inline-flex; align-items: center; gap: var(--space-1); }
.base-badge-core { display: grid; place-items: center; }
.base-badge-core > * { grid-area: 1 / 1; }
.base-badge-svg { display: block; width: var(--control-h-sm); height: var(--control-h-sm); overflow: visible; }

.base-badge-track { fill: none; stroke: var(--color-border-subtle); stroke-width: 3; }
.base-badge-ring { fill: none; stroke-width: 3; stroke-linecap: round; }
.is-capturing-friendly .base-badge-ring { stroke: var(--color-team-ally); }
.is-capturing-enemy .base-badge-ring { stroke: var(--color-team-enemy); }
.is-assault .base-badge-ring { stroke: var(--color-objective); }

.base-badge-fill { fill: var(--color-team-neutral); }
.is-owner-friendly .base-badge-fill { fill: var(--color-team-ally); }
.is-owner-enemy .base-badge-fill { fill: var(--color-team-enemy); }

.base-badge-letter {
  fill: var(--color-canvas);
  font: var(--type-caption);
  font-weight: 800;
  text-anchor: middle;
  dominant-baseline: central;
}

.is-owner-neutral .base-badge-letter { fill: var(--color-on-team-neutral); }

/* 旗帜图标叠在徽章圆心（单基地没有字母） */
.base-badge-flag { color: var(--color-on-team-neutral); }
.base-objective-progress { color: var(--color-objective); font: var(--type-caption); font-weight: 700; font-variant-numeric: tabular-nums; }

@media (width < 768px) {
  .base-status-bar { gap: var(--space-1); padding: 2px var(--space-2); }
}
/* HUD metadata shares a single compact row with map and time. */
.base-status-bar.is-compact { gap: var(--space-1); padding: 0; border: 0; background: transparent; backdrop-filter: none; }
.is-compact .base-badge-svg { width: var(--space-6); height: var(--space-6); }
</style>
