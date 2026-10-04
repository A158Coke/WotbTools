<script setup>
import { computed, ref, watch } from 'vue'
import { hpPercentText } from '../scene/rosterState.js'
import { usePlaybackDetailsPlacement } from '../composables/usePlaybackDetailsPlacement.js'
import V2VehicleInspector from './V2VehicleInspector.vue'

defineOptions({ name: 'VehicleDetailsPanel' })

const props = defineProps({
  selectedState: { type: Object, default: null },
  selectedPortraitUrl: { type: String, default: null },
  selLastKnownSec: { type: Number, default: null },
  /** Optional authoritative subset; missing counters do not mean zero. */
  selCurStats: { type: Object, default: null },
  /** Common subset health for renderers without the richer V2 track inspector. */
  health: { type: Object, default: null },
  phoneForm: { type: Boolean, default: false },
  selectedTrack: { type: Object, default: null },
  currentTime: { type: Number, default: 0 },
  selDamageLog: { type: Array, default: () => [] },
  formatClock: { type: Function, required: true },
  /**
   * 呈现方式（**同一个组件**，不复制第二份详情）：
   *   'floating'  workspace 顶层的可拖动浮窗（宽档 / 横屏）
   *   'inline'    纵向流里的普通内容块（手机竖屏，排在传输控件之后）
   */
  presentation: { type: String, default: 'floating' },
  /** 浮窗宿主 = **整个战场 workspace**（2D 的 `.pb-main`、3D 的 `.pb-root`：Team 1 / Stage /
      Team 2 三栏共同的定位祖先）。浮窗是它的直接子元素，`left/top`、夹紧与拖动都在同一个
      坐标系里计算；inline 形态不需要。 */
  dragHost: { type: Object, default: null },
  /** 受保护区域（传输控件）：浮窗下缘不得越过它。 */
  dragBounds: { type: Object, default: null },
  /** 浮窗初始落位偏好：点左侧名册 → 'right'，点右侧名册 → 'left'，点场景里的车 → 屏幕上
      与它相对的一侧。只在用户还没亲手拖过时生效。 */
  initialSide: { type: String, default: 'right' },
  /** 当前选中对象的身份（accountId / eid）。同一次打开内换车时据此重新落位（未拖过时）。 */
  selectionKey: { type: null, default: null },
})

const emit = defineEmits(['close'])
const currentHp = computed(() => Number.isFinite(props.health?.currentHp) ? Math.max(0, Math.round(props.health.currentHp)) : null)
const maxHp = computed(() => Number.isFinite(props.health?.maxHp) && props.health.maxHp > 0 ? Math.round(props.health.maxHp) : null)
const hpPercentage = computed(() => currentHp.value == null || maxHp.value == null ? null : hpPercentText(currentHp.value, maxHp.value))

const panelEl = ref(null)
const floating = computed(() => props.presentation !== 'inline')
/* 宿主与保护区是 props（父组件传进来的模板 ref）。这里必须把它们**摊平成普通 ref**：
   composable 只认「一个带 `.value` 的 ref」，把 `computed(() => props.dragHost)` 传进去
   得到的是 ref-in-ref，`boundsEl.value` 会是 computed 本身而不是元素，边界检查静默失效。 */
const dragHost = ref(null)
const dragBounds = ref(null)
watch(() => props.dragHost, (el) => { dragHost.value = el || null }, { immediate: true })
watch(() => props.dragBounds, (el) => { dragBounds.value = el || null }, { immediate: true })
const { pos, onPointerDown, onSelectionChange } = usePlaybackDetailsPlacement({
  isActive: () => !!props.selectedState && floating.value,
  hostEl: dragHost,
  boundsEl: dragBounds,
  panelEl,
  initialSide: computed(() => props.initialSide),
})
watch([() => props.selectionKey, () => props.initialSide], onSelectionChange)
const floatingStyle = computed(() => (floating.value && pos.value
  ? { left: `${pos.value.left}px`, top: `${pos.value.top}px` }
  : null))
</script>

<template>
  <aside
    v-if="props.selectedState"
    ref="panelEl"
    class="pb-sidebar"
    :class="{ 'phone-form': props.phoneForm, 'pb-floating': floating, 'pb-inline': !floating }"
    data-test="pb-info"
    :data-presentation="props.presentation"
    :style="floatingStyle"
    :aria-label="$t('recon.map.playback.detail')"
  >
    <div class="pb-sb-head">
      <!-- 拖动柄：浮窗形态下整个头部都可以拖（标题 + 柄）。inline 形态没有柄——
           纵向流里的内容块没有「位置」可拖，画一个柄等于承诺一个不存在的操作。 -->
      <span
        v-if="floating"
        class="pb-sb-drag"
        data-test="pb-sb-drag"
        role="presentation"
        @pointerdown="onPointerDown"
      >
        <span class="pb-sb-grip" aria-hidden="true" />
        <span class="pb-sb-title">
          <strong data-test="pb-sb-tank">{{ props.selectedState.vehicle.tankName || props.selectedState.vehicle.tankId || '—' }}</strong>
          <span class="pb-sb-player" data-test="pb-sb-player">{{ props.selectedState.vehicle.playerName || '—' }}</span>
        </span>
      </span>
      <span v-else class="pb-sb-title">
        <strong data-test="pb-sb-tank">{{ props.selectedState.vehicle.tankName || props.selectedState.vehicle.tankId || '—' }}</strong>
        <span class="pb-sb-player" data-test="pb-sb-player">{{ props.selectedState.vehicle.playerName || '—' }}</span>
      </span>
      <button type="button" class="pb-close pb-sb-close" data-test="pb-sb-close" :aria-label="$t('recon.map.playback.close')" @click="emit('close')">&times;</button>
    </div>
    <div v-if="props.selectedPortraitUrl" class="pb-sb-portrait" data-test="pb-sb-portrait">
      <img :src="props.selectedPortraitUrl" :alt="props.selectedState.vehicle.tankName || String(props.selectedState.vehicle.tankId)" />
    </div>
    <dl class="pb-sb-grid">
      <dt>{{ $t('recon.map.playback.team') }}</dt>
      <dd>
        <span data-test="pb-sb-team">{{ $t(props.selectedState.vehicle.team === 1 ? 'agentReplay.team1' : props.selectedState.vehicle.team === 2 ? 'agentReplay.team2' : 'agentReplay.teamUnknown') }}</span>
        <span v-if="typeof props.selectedState.vehicle.friendly === 'boolean'" data-test="pb-sb-relation"> · {{ $t(props.selectedState.vehicle.friendly ? 'recon.map.playback.team_friendly' : 'recon.map.playback.team_enemy') }}</span>
      </dd>
      <template v-if="props.selectedState.destroyed">
        <dt>{{ $t('recon.map.playback.state') }}</dt>
        <dd data-test="pb-sb-state">{{ $t('recon.map.playback.state_destroyed') }}</dd>
      </template>
      <template v-if="props.health">
        <dt>{{ $t('recon.map.playback.current_hp') }}</dt>
        <dd data-test="pb-sb-hp">
          <template v-if="props.selectedState.destroyed">{{ $t('recon.map.playback.state_destroyed') }}</template>
          <template v-else>
            <span data-test="pb-sb-hp-current">{{ currentHp ?? '—' }}</span>
            <span v-if="maxHp != null" data-test="pb-sb-hp-max"> / {{ maxHp }}</span>
            <span data-test="pb-sb-hp-percentage"> · {{ hpPercentage == null ? '—' : `${hpPercentage}%` }}</span>
          </template>
        </dd>
      </template>
      <template v-if="props.selLastKnownSec != null">
        <dt>{{ $t('recon.map.playback.last_spotted') }}</dt>
        <dd>{{ props.formatClock(props.selLastKnownSec) }}</dd>
      </template>
      <template v-if="props.selectedState.destroyed && props.selectedState.destroyedKnownAtSec != null">
        <dt>{{ $t('recon.map.playback.destroyed_at') }}</dt>
        <dd>{{ props.formatClock(props.selectedState.destroyedKnownAtSec) }}</dd>
      </template>
      <dt>{{ $t('recon.map.playback.playback_time') }}</dt>
      <dd>{{ props.formatClock(props.currentTime) }}</dd>
      <template v-if="Number.isFinite(props.selCurStats?.dealt)">
        <dt>{{ $t('recon.map.playback.damage_recorded') }}</dt>
        <dd data-test="pb-sb-dealt">{{ props.selCurStats.dealt }}</dd>
      </template>
      <template v-if="Number.isFinite(props.selCurStats?.received)">
        <dt>{{ $t('recon.map.playback.damage_received') }}</dt>
        <dd data-test="pb-sb-received">{{ props.selCurStats.received }}</dd>
      </template>
      <template v-if="Number.isFinite(props.selCurStats?.kills)">
        <dt>{{ $t('recon.map.playback.kills') }}</dt>
        <dd data-test="pb-sb-kills">{{ props.selCurStats.kills }}</dd>
      </template>
    </dl>
    <V2VehicleInspector
      v-if="props.selectedTrack"
      data-test="pb-sb-v2-inspector"
      :track="props.selectedTrack"
      :time-sec="props.currentTime"
    />
    <template v-if="props.selDamageLog?.length">
      <div class="pb-sb-section">{{ $t('recon.map.playback.damage_log') }}</div>
      <ul class="pb-sb-log">
        <li v-for="(damage, index) in props.selDamageLog" :key="index">
          <span class="pb-sb-log-time">{{ props.formatClock(damage.timeSec) }}</span>
          <span v-if="damage.dir === 'in'" class="pb-sb-log-in">−{{ damage.hpLoss }} <em>{{ damage.label }}</em></span>
          <span v-else class="pb-sb-log-out">+{{ damage.hpLoss }} → {{ damage.label }}</span>
        </li>
      </ul>
    </template>
  </aside>
</template>

<style scoped>
.pb-sidebar { width: calc(var(--sidebar-full-w) + var(--space-5)); max-width: 100%; min-width: 0; flex-shrink: 0; align-self: stretch; font-size: var(--font-size-caption); line-height: var(--line-height-caption); color: var(--color-text-primary); background: var(--color-surface-1); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); padding: var(--space-2); overflow-y: auto; max-height: 72dvh; }
/* 浮窗形态：workspace 顶层的一块面。位置由 usePlaybackDetailsPlacement 写 left/top
   （未定位的首帧落在左上角，随后立即被夹进宿主）。
   宽度固定一档（不借用 2D 的 `--pb-details-w` 列宽 token：手机全屏下那个 token 是 0）。
   这里只负责「它是一块浮起来的卡片」，不负责它在哪——位置与边界是 JS 的所有权。 */
.pb-sidebar.pb-floating {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  z-index: var(--pb-z-modal);
  width: min(340px, 92%);
  max-height: min(60dvh, 520px);
  box-shadow: var(--elevation-3);
}
/* inline 形态（手机竖屏）：纵向流里的普通内容块，跟着页面滚，不设自己的高度上限。 */
.pb-sidebar.pb-inline { width: 100%; max-height: none; margin-top: var(--space-2); }
.pb-sb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); margin-bottom: var(--space-1); }
.pb-sb-drag { display: flex; align-items: flex-start; gap: var(--space-2); flex: 1 1 auto; min-width: 0; cursor: grab; touch-action: none; user-select: none; }
.pb-sb-drag:active { cursor: grabbing; }
.pb-sb-grip { flex: none; width: var(--space-3); height: var(--space-3); margin-top: var(--space-1); border-radius: var(--radius-sm); background: linear-gradient(to bottom, var(--color-border-subtle) 0 2px, transparent 2px 5px, var(--color-border-subtle) 5px 7px, transparent 7px 10px, var(--color-border-subtle) 10px 12px); }
.pb-sb-title { display: flex; flex-direction: column; min-width: 0; }
.pb-sb-title strong { color: var(--color-text-primary); font-size: var(--font-size-body); line-height: var(--line-height-body); overflow-wrap: anywhere; }
.pb-sb-player { color: var(--color-text-secondary); font-size: var(--font-size-caption); overflow-wrap: anywhere; }
.pb-sb-close { flex: none; min-width: var(--hit-min); min-height: var(--hit-min); font-size: var(--font-size-h3); line-height: var(--line-height-h3); padding: 0 var(--space-1); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-text-primary); cursor: pointer; }
.pb-sb-close:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.pb-sb-portrait { display: grid; place-items: center; min-height: calc(var(--space-12) * 2); margin: var(--space-1) 0 var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-2); overflow: hidden; }
.pb-sb-portrait img { display: block; width: min(100%, calc(var(--space-12) * 4)); height: calc(var(--space-12) * 2); object-fit: contain; }
.pb-sb-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-1) var(--space-2); margin: 0; }
.pb-sb-grid dt { color: var(--color-text-secondary); white-space: nowrap; }
.pb-sb-grid dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.pb-sb-section { margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--color-border-subtle); font-weight: 700; color: var(--color-text-primary); }
.pb-sb-log { margin: var(--space-1) 0 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-1); max-height: calc(var(--space-12) * 3); overflow-y: auto; }
.pb-sb-log li { display: flex; gap: var(--space-2); font-variant-numeric: tabular-nums; align-items: baseline; }
.pb-sb-log-time { color: var(--color-text-secondary); flex-shrink: 0; }
.pb-sb-log-in { color: var(--color-team-enemy); }
.pb-sb-log-out { color: var(--color-team-ally); }
.pb-sb-log em { font-style: normal; opacity: .75; }
.pb-sidebar.phone-form { width: 100%; max-height: none; }
</style>
