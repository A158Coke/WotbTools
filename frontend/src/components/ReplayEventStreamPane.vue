<script setup lang="ts">
// 统一事件流 pane（借鉴 blitzinfo 战斗日志）：合并 Playback facet 的事件源为单一
// 时间轴，过滤器 chips + 点击 seek（切到 3D 后由工作台执行）。
// 数据源 = playbackSession.loadScene(file)（与 3D 面板同一缓存解析，不重复跑 WASM）。
// 射击事件的「装甲检视」走现有射击复现入口（storeShotsForViewer + shotViewerQuery，
// 与 ReplayShotsPane.openInViewer 同一交接通道），本 pane 不自建任何 viewer 契约。
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { enrichShotsFromRoster, parseAgentShotsFromBytes } from '../api/agent-replay-facets.js'
import { resolveReplayClock } from '../replay-local/canonical/facts'
import { annotateMountedConfigs, buildPitchLimits } from '../scene/shotHandoff.ts'
import { storeShotsForViewer, shotViewerQuery } from '../scene/agentData.js'
import type { ShotViewerInput } from '../scene/agentData.js'
import {
  buildEventStream, filterEvents, EVENT_FILTERS,
} from '../utils/playbackEventStream.ts'
import type { AgentPlaybackFacet, AgentPlaybackShot } from '../api/agent-replay-facets'
import type { PlaybackEventRow } from '../utils/playbackEventStream'
import type { EventFilterKey } from '../utils/playbackEventStream'

/** 工作台会话的最小消费面（loadScene 命中缓存，不重复解析）。 */
interface PlaybackSessionLike {
  loadScene?: (file: File) => Promise<AgentPlaybackFacet>
}
/** 射击复现交接用的 facet 行：ShotViewerInput（交接契约）+ 事件匹配所需的三个字段。 */
type ShotReplayRow = ShotViewerInput & {
  time_s?: number
  shooter_eid?: number
  target_eid?: number | null
}
type NavigateFn = (payload: { query: Record<string, string> }) => void

const props = withDefaults(defineProps<{
  file?: File | null
  active?: boolean
  playbackSession?: PlaybackSessionLike | null
  /** 与 ReplayShotsPane 同一导航通道（armor 查看器路由由工作台拥有） */
  navigate?: NavigateFn | null
}>(), { file: null, active: false, playbackSession: null, navigate: null })
const emit = defineEmits(['view-3d'])

const { t } = useI18n()
const { requireFeature } = useFeatureGate()

const loading = ref(false)
const err = ref('')
const facet = ref<AgentPlaybackFacet | null>(null)
const parsedFile = ref<File | null>(null)
/** 解析代次：换文件/重入即递增；迟到的旧结果不得覆盖新文件的状态（同 ReplayShotsPane 纪律）。 */
let loadGen = 0
/** 装甲交接代次：换文件/离开事件流/新点击即作废在途请求。 */
let handoffSeq = 0
const filter = ref<EventFilterKey>('all')
const RenderCap = 800

const events = computed(() => buildEventStream(facet.value))
const filtered = computed(() => filterEvents(events.value, filter.value))
const shown = computed(() => filtered.value.slice(0, RenderCap))
const overflow = computed(() => Math.max(0, filtered.value.length - shown.value.length))
const counts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const e of events.value) out[e.filter] = (out[e.filter] || 0) + 1
  return out
})

async function ensureFacet() {
  const file = props.file
  if (!file || !props.playbackSession?.loadScene) return
  if (parsedFile.value === file) return
  const gen = ++loadGen
  loading.value = true
  err.value = ''
  try {
    const loaded = await props.playbackSession.loadScene(file)
    if (gen !== loadGen) return // 迟到结果：文件已切换/重入，丢弃
    facet.value = loaded
    parsedFile.value = file
    // 换文件后射击缓存与旧文件绑定，必须作废（装甲检视不得读上一场的行）
    shotsCache = { file: null, rows: [] }
  } catch (e) {
    if (gen !== loadGen) return
    err.value = String((e as Error)?.message || e)
  } finally {
    if (gen === loadGen) loading.value = false
  }
}

/** 换文件：清除旧场展示并让在途请求作废；激活时立即按新文件重载。 */
watch(
  () => props.file,
  () => {
    loadGen++
    facet.value = null
    parsedFile.value = null
    err.value = ''
    loading.value = false
    shotsCache = { file: null, rows: [] }
    handoffSeq++
    if (props.active) void ensureFacet()
  },
)
watch(
  () => props.active,
  (active) => {
    // 离开事件流 = 在途装甲交接作废（旧 query 返回后不得把用户拉走）
    if (!active) handoffSeq++
    if (active && !facet.value) void ensureFacet()
  },
  { immediate: true },
)

/** 点击事件 → seek 该时刻。seek 属于 3D 场景（sceneApi 由 Replay3DPane 持有），
 *  本 pane 只发出（工作台切 tab + 转交），不直接触碰场景。 */
function onClick(ev: PlaybackEventRow | null) {
  if (ev == null) return
  emit('view-3d', ev.t)
}

// ---- 装甲检视（射击事件；现有射击复现入口，见 ReplayShotsPane.openInViewer）----
const shotsBusy = ref(false)
let shotsCache: { file: File | null; rows: ShotReplayRow[] } = { file: null, rows: [] }

function rowHas3d(s: ShotReplayRow): boolean {
  return s.target_eid != null
}

async function openInArmorViewer(ev: PlaybackEventRow | null) {
  if (!requireFeature(Feature.PLAYBACK_3D)) return
  const s: AgentPlaybackShot | undefined = ev?.shot
  if (!s || !rowHas3d(s as ShotReplayRow)) return
  if (!props.navigate || !props.file) return
  // 快照归属：文件 + 当时的 facet（车型/开战时钟/周期都按它算，不得读切场后的 live）
  const file = props.file
  const facetSnap = facet.value
  const seq = ++handoffSeq
  const stillCurrent = () => seq === handoffSeq && file === props.file && props.active
  shotsBusy.value = true
  try {
    // 射击复现消费 shots facet 行（含 ball_a/ball_b 段与配件串）——按需解析一次并缓存
    if (shotsCache.file !== file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      // 俯仰锚定（与 ReplayShotsPane 同一实现）：只传基础极限，122 稳定器由 core 叠加
      let pitchLimits: Awaited<ReturnType<typeof buildPitchLimits>> | null = null
      try {
        pitchLimits = await buildPitchLimits(facetSnap?.vehicles || [])
      } catch { /* 资产不可用：如实降级 */ }
      if (!stillCurrent()) return
      const outcome = await parseAgentShotsFromBytes(bytes, pitchLimits ?? undefined).catch(async () => {
        // 锚定注入失败（产物过旧等）→ 裸解析兜底（与 ReplayShotsPane 同款）
        return parseAgentShotsFromBytes(bytes)
      })
      // 名册补齐车型身份（与 ReplayShotsPane 同款）：原始 WASM 射击行只有 eid 时
      // shotViewerQuery 会因两车型 id 缺失返回 null，按钮静默无效。
      // 解析完成：用户可能已切场/切能力——不再写缓存、不继续交接
      if (!stillCurrent()) return
      const rows = (outcome.shots || []) as ShotReplayRow[]
      const vehicles = facetSnap?.vehicles
      if (Array.isArray(vehicles)) {
        enrichShotsFromRoster(rows as never[], vehicles)
        // 实际搭载配置下标（多炮车：炮塔/炮管/弹表变体）——与射击分析入口同源
        await annotateMountedConfigs(rows as never[], vehicles)
      }
      if (!stillCurrent()) return
      shotsCache = { file, rows: rows.filter(rowHas3d) }
    }
    // 事件行 → shots facet 行：同一发 = (shooter_eid, target_eid, |Δt|≤0.05s)
    const row = shotsCache.rows.find(
      (r) => r.shooter_eid === s.shooter_eid && r.target_eid === s.target_eid
        && Math.abs((r.time_s ?? 0) - ev!.t) <= 0.05,
    )
    if (!row) return
    // 快照语义与 ReplayShotsPane 一致：交接 JSON 按点击时版本序列化
    const snapshot = JSON.parse(JSON.stringify(row)) as ShotReplayRow
    // 开战时钟原点与射击分析入口同一推导（3D 场景 / ReplayShotsPane 同源）：
    // 有开战前倒计时的场次，原始 time_s 不是开战相对时间。
    const battleStartRaw = resolveReplayClock(
      facetSnap?.periods || [], null, facetSnap?.meta?.duration,
    )?.startRaw ?? 0
    storeShotsForViewer(JSON.parse(JSON.stringify(shotsCache.rows)), { battleStartRaw })
    const query = await shotViewerQuery(snapshot)
    if (!query) return
    // query 返回后再次校验：切场后旧 query 不得把用户带进上一场的装甲检视
    if (!stillCurrent()) return
    props.navigate({ query: query as Record<string, string> })
  } finally {
    shotsBusy.value = false
  }
}

const KIND_ICON: Record<string, string> = {
  shot: '◎', damage: '✦', kill: '☠', capture: '🚩', observed: '👁',
  chat: '💬', command: '📣', presence: '·',
  notice: 'ℹ', module: '⚙', moduleDamage: '⚙', destructible: '🌳',
  consumable: '⏱', death: '☠', revive: '✚',
}

function verdictClass(ev: PlaybackEventRow): string {
  return ev.verdict ? `ev-${ev.verdict}` : ''
}

/** 名册身份文本：昵称 · 车名（缺一即省略；全缺回退 eid） */
function actorText(a?: { eid: number; name?: string; tank?: string }): string {
  if (!a) return '-'
  const parts = [a.name || `#${a.eid}`]
  if (a.tank) parts.push(a.tank)
  return parts.join(' · ')
}

function verdictText(ev: PlaybackEventRow): string {
  switch (ev.verdict) {
    case 'penetrated': return t('eventStream.verdict_penetrated')
    case 'blocked': return t('eventStream.verdict_blocked')
    case 'ricochet': return t('eventStream.verdict_ricochet')
    case 'he': return t('eventStream.verdict_he')
    case 'kill': return t('eventStream.verdict_kill')
    default: return ''
  }
}

function eventTitle(ev: PlaybackEventRow): string {
  switch (ev.kind) {
    case 'shot': {
      const head = t('eventStream.shot_line', { from: actorText(ev.actor), to: actorText(ev.target) })
      const parts = [head]
      const v = verdictText(ev)
      if (v) parts.push(v)
      if (ev.shotDamage) parts.push(t('eventStream.damage_part', { n: ev.shotDamage }))
      if (ev.shotKill) parts.push(t('eventStream.kill_part'))
      return parts.join(' · ')
    }
    case 'chat': {
      const ch = ev.channelName ? `[${ev.channelName}] ` : ''
      const who = ev.sender ? `${ev.sender}: ` : ''
      return `${ch}${who}${ev.text || ''}`
    }
    case 'command': {
      const ch = ev.channelName ? ` · ${ev.channelName}` : ''
      return t('eventStream.command_line', { sender: ev.sender || '?', code: ev.command ?? '?' }) + ch
    }
    case 'presence': return t('eventStream.presence_label', { name: ev.sender || '?' })
    case 'moduleDamage':
    case 'module':
      return `${actorText(ev.actor)} · ${ev.text || t('eventStream.module_label')}`
    case 'damage': return t('eventStream.damage_label', {
      from: actorText(ev.actor),
      to: actorText(ev.target),
      n: ev.damage ?? 0,
    })
    case 'capture': {
      if (ev.progress != null) return t('eventStream.capture_progress', { n: ev.progress })
      return t(`eventStream.capture_${ev.captureState ?? 'invading'}`, {
        base: String.fromCharCode(65 + (ev.baseId ?? 0)),
        team: ev.team ?? '-',
      })
    }
    case 'observed': return t('eventStream.observed_label', { who: actorText(ev.actor) })
    case 'destructible': return t('eventStream.destructible_label')
    case 'notice': return t('eventStream.notice_label', { code: ev.code ?? '?' })
    case 'consumable':
      return `${actorText(ev.actor)} · ${ev.text || t('eventStream.consumable_label')}`
    case 'death': return t('eventStream.death_label')
    case 'revive': return t('eventStream.revive_label')
    case 'kill': return t('eventStream.kill_label', { from: actorText(ev.actor), to: actorText(ev.target) })
    default: return t('eventStream.shot_label')
  }
}

/** 该行是否可直接进射击复现（有目标的事实行） */
function canOpenShot(ev: PlaybackEventRow): boolean {
  return ev.kind === 'shot' && ev.shot != null && ev.targetEid != null
}

/** 行主体点击：射击行 → 射击复现；其余 → 跳到该时刻 */
function onRowClick(ev: PlaybackEventRow) {
  if (canOpenShot(ev)) {
    void openInArmorViewer(ev)
    return
  }
  onClick(ev)
}

function filterCount(key: EventFilterKey): number {
  if (key === 'all') return events.value.length
  return counts.value[key] || 0
}
</script>

<template>
  <section class="event-stream" data-testid="ws-event-stream" data-pane-ready="true">
    <div v-if="!props.file" class="es-empty">{{ $t('eventStream.no_file') }}</div>
    <template v-else>
      <div v-if="loading" class="es-status">{{ $t('eventStream.loading') }}</div>
      <div v-else-if="err" class="es-status es-err">{{ err }}</div>
      <template v-else>
        <div class="es-filters" role="group" :aria-label="$t('eventStream.filters_aria')">
          <button
            v-for="f in EVENT_FILTERS"
            :key="f.key"
            type="button"
            class="es-chip"
            :class="{ on: filter === f.key }"
            :data-filter="f.key"
            :aria-pressed="filter === f.key"
            @click="filter = f.key"
          >
            {{ $t(f.labelKey) }} <output class="es-count">{{ filterCount(f.key) }}</output>
          </button>
        </div>
        <p v-if="overflow > 0" class="es-overflow">
          {{ $t('eventStream.overflow', { n: overflow }) }}
        </p>
        <ul class="es-list" data-testid="event-list">
          <li v-for="(ev, i) in shown" :key="`${ev.t}-${ev.kind}-${i}`" class="es-row">
            <output class="es-time">{{ ev.t.toFixed(1) }}s</output>
            <span class="es-icon" :class="verdictClass(ev)" aria-hidden="true">{{ KIND_ICON[ev.kind] || '•' }}</span>
            <button
              type="button"
              class="es-body"
              :data-kind="ev.kind"
              :class="{ 'es-body-shot': canOpenShot(ev) }"
              :title="canOpenShot(ev) ? $t('eventStream.open_shot_hint') : ''"
              @click="onRowClick(ev)"
            >
              <span class="es-text">{{ eventTitle(ev) }}</span>
              <span class="es-kind">{{ $t(`eventStream.kind_${ev.kind}`) }}</span>
            </button>
            <button
              v-if="canOpenShot(ev)"
              type="button"
              class="es-armor"
              data-testid="es-seek"
              :title="$t('eventStream.seek_here')"
              @click.stop="onClick(ev)"
            >
              ⏱
            </button>
          </li>
        </ul>
        <p v-if="!filtered.length" class="es-empty">{{ $t('eventStream.none') }}</p>
      </template>
    </template>
  </section>
</template>

<style scoped>
/* 设计语言 token 化（stylelint: 禁 hex/rgba，字号/圆角/z 必须走 token；
   胶囊圆角与 corner-shape 同条声明是仓库的 squircle 守卫要求）。 */
.event-stream { display: flex; flex-direction: column; gap: var(--space-2); block-size: 100%; overflow: auto; }
.es-filters { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.es-chip {
  border: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  border-radius: var(--radius-full);
  corner-shape: round;
  padding: var(--space-1) var(--space-2);
  font: var(--type-caption);
  cursor: pointer;
}
.es-chip.on { background: var(--color-accent); border-color: transparent; color: var(--color-on-accent); }
.es-count { opacity: .7; margin-inline-start: var(--space-1); }
/* 选中 chip 为实心强调底：计数与主标签同用 on-accent 且不降透明度（4.5:1） */
.es-chip.on .es-count { opacity: 1; }
.es-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.es-row { display: flex; align-items: center; gap: var(--space-2); padding: 2px var(--space-1); border-radius: var(--radius-sm); }
.es-row:hover { background: color-mix(in srgb, var(--color-text-primary) 5%, transparent); }
.es-time { font-variant-numeric: tabular-nums; font: var(--type-caption); color: var(--color-text-tertiary); min-inline-size: 56px; }
.es-icon { inline-size: 18px; text-align: center; }
.es-icon.ev-kill { color: var(--color-danger); }
.es-icon.ev-penetrated, .es-icon.ev-he { color: var(--color-warning); }
.es-icon.ev-ricochet, .es-icon.ev-blocked { color: var(--color-text-tertiary); }
.es-body {
  flex: 1;
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  background: none;
  border: 0;
  color: inherit;
  text-align: start;
  cursor: pointer;
  padding: 0;
}
.es-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.es-kind { font: var(--type-caption); color: var(--color-text-tertiary); }
.es-armor {
  border: 1px solid var(--color-border-subtle);
  background: none;
  color: var(--color-text-primary);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font: var(--type-caption);
  cursor: pointer;
}
.es-armor:disabled { opacity: .5; cursor: wait; }
.es-status, .es-empty { padding: var(--space-3) var(--space-1); color: var(--color-text-secondary); }
.es-err { color: var(--color-danger); }
.es-overflow { font: var(--type-caption); color: var(--color-text-tertiary); margin: 0; }
</style>
