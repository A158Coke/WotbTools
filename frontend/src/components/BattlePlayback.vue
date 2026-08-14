<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapImages } from '../data/mapImages'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette'
import { createMapView } from '../utils/mapView'
import enemyHull from '../assets/tank-icons/tank-marker-enemy-hull.png'
import enemyTurret from '../assets/tank-icons/tank-marker-enemy-turret.png'
import friendlyHull from '../assets/tank-icons/tank-marker-friendly-hull.png'
import friendlyTurret from '../assets/tank-icons/tank-marker-friendly-turret.png'
import {
  aggregateEventsBySecond,
  clampViewPan,
  formatClock,
  interpolateDirection,
  lastKnownPosition,
  positionAt,
  positionCoveredAt,
  recorderRelated,
  routePrefix,
  screenRotation,
  teamRelated,
  tracerLines,
  turretWorldYawDeg,
  zoomViewAt
} from '../utils/battlePlayback'

/**
 * 战局回放（Battle Playback）：地图鸟瞰第三视图。
 * 复用 mapImages 素材、coordinateBounds 坐标映射、自适应色板与响应式布局；
 * RAF 推进播放时间，仅在同一可信连续点（gap ≤ 5s）之间插值。
 */
const props = defineProps({
  overview: { type: Object, required: true },
  seekTo: { type: Number, default: null }
})

const { t } = useI18n()

const image = computed(() => mapImages[props.overview.mapCode] || null)
const mapView = computed(() => createMapView(image.value, props.overview))

// 自适应配色（与热力/路线视图同一色板）
const palette = ref(darkMapPalette)
watch(image, async (img) => {
  palette.value = paletteForLuminance(await luminanceOfImage(img))
}, { immediate: true })

const playback = computed(() => props.overview.playback || null)
const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
const friendlyTeam = computed(() => props.overview.friendlyTeam)

// ---- 播放状态 ----
const currentTime = ref(0)
const playing = ref(false)
const speed = ref(1)
const showAll = ref(false)
const typeFilter = ref(new Set(['DAMAGE', 'DESTROYED', 'KILL', 'POSITION_REPORTED', 'POSITION_STALE']))
const selectedAccountId = ref(null)
const eventPopupSec = ref(null)
let rafId = null
let lastFrameTs = null

// ---- 地图视图缩放/平移：单一 transform 层保证地图/网格/路线/炮线/标记严格对齐 ----
const mapEl = ref(null)
const view = reactive({ scale: 1, tx: 0, ty: 0 })
const PAN_THRESHOLD_PX = 5
const PINCH_THRESHOLD_PX = 5
const ZOOM_STEP = 1.2
const pointers = new Map()
let panStart = null
let pinchStart = null
let suppressClick = false
// 当前交互是否为真实手势（单指拖动超阈值 / 双指捏合距离或中点移动超阈值）：
// 手势结束后的首个 click 必须被吞掉，纯点击车辆仍正常选中
let gestureMoved = false

function applyView(next) {
  const clamped = clampViewPan(
    next,
    mapEl.value ? mapEl.value.clientWidth : 0,
    mapEl.value ? mapEl.value.clientHeight : 0
  )
  view.scale = clamped.scale
  view.tx = clamped.tx
  view.ty = clamped.ty
}

const viewportStyle = computed(() => `transform: translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`)

// 车辆标记固定屏幕尺寸：标记中心锚定在地图坐标（left/top % 经 viewport 变换），
// 标记本体按 1/view.scale 反缩放，保证 28px/22px 在 1×–4× 下不变；
// hull/turret 的方向旋转在子元素 img 上，不受该反缩放影响。
const markerTransform = computed(() => `translate(-50%, -50%) scale(${1 / view.scale})`)

/** 指针 client 坐标 → 相对地图容器的**屏幕坐标**（zoomViewAt 契约，不参与任何变换）。 */
function screenPoint(clientX, clientY) {
  const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function onWheel(e) {
  const p = screenPoint(e.clientX, e.clientY)
  applyView(zoomViewAt(view, p.x, p.y, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
}

function pinchInfo() {
  const [a, b] = [...pointers.values()]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
}

function onPointerDown(e) {
  suppressClick = false
  gestureMoved = false
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  // 指针捕获（受支持时）：指针移出地图仍持续收到 move/up；不支持的环境走 window 级兜底
  try {
    if (typeof e.target.setPointerCapture === 'function') {
      e.target.setPointerCapture(e.pointerId)
    }
  } catch {
    // 某些测试环境不支持指针捕获，忽略
  }
  if (pointers.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
  } else if (pointers.size === 2) {
    const info = pinchInfo()
    pinchStart = {
      mid: info.mid,
      dist: info.dist,
      // 锚点 = 双指中点相对地图容器的屏幕坐标（zoomViewAt 契约）
      anchorScreen: screenPoint(info.mid.x, info.mid.y),
      scale: view.scale,
      tx: view.tx,
      ty: view.ty,
      moved: false
    }
    panStart = null
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2 && pinchStart) {
    const { mid, dist } = pinchInfo()
    if (!pinchStart.moved
        && (Math.abs(dist - pinchStart.dist) > PINCH_THRESHOLD_PX
            || Math.hypot(mid.x - pinchStart.mid.x, mid.y - pinchStart.mid.y) > PINCH_THRESHOLD_PX)) {
      pinchStart.moved = true
      gestureMoved = true
    }
    if (pinchStart.dist > 0 && dist > 0) {
      const next = zoomViewAt(
        { scale: pinchStart.scale, tx: pinchStart.tx, ty: pinchStart.ty },
        pinchStart.anchorScreen.x, pinchStart.anchorScreen.y, dist / pinchStart.dist
      )
      // 两指中点整体移动 = 屏幕平移（translate 单位为屏幕像素，直接加 client 位移）
      next.tx += mid.x - pinchStart.mid.x
      next.ty += mid.y - pinchStart.mid.y
      applyView(next)
    }
    return
  }
  if (pointers.size === 1 && panStart) {
    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y
    if (!panStart.moved && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return
    panStart.moved = true
    gestureMoved = true
    applyView({ scale: view.scale, tx: panStart.tx + dx, ty: panStart.ty + dy })
  }
}

function onPointerUp(e) {
  if (!pointers.delete(e.pointerId)) return
  if (gestureMoved) suppressClick = true
  try {
    if (typeof e.target.releasePointerCapture === 'function') {
      e.target.releasePointerCapture(e.pointerId)
    }
  } catch {
    // 忽略（无捕获或已释放）
  }
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 0) {
    panStart = null
    gestureMoved = false
  } else if (pointers.size === 1 && pinchStart == null && panStart == null) {
    // 捏合结束剩下一根手指：以该手指为新基线继续平移，状态不卡死
    const [p] = [...pointers.values()]
    panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, moved: false }
  }
}

/** 拖动/捏合结束后吞掉随之而来的 click 避免误选车；未拖动的点击正常到达车辆按钮。 */
function onViewportClick(e) {
  if (suppressClick) {
    suppressClick = false
    e.stopPropagation()
    e.preventDefault()
  }
}

function resetView() {
  applyView({ scale: 1, tx: 0, ty: 0 })
}

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
})

function frame(ts) {
  if (!playing.value) {
    rafId = null
    return
  }
  const delta = lastFrameTs == null ? 0 : (ts - lastFrameTs)
  lastFrameTs = ts
  currentTime.value = Math.min(duration.value, currentTime.value + (delta / 1000) * speed.value)
  if (currentTime.value >= duration.value) {
    playing.value = false
    rafId = null
    return
  }
  rafId = requestAnimationFrame(frame)
}

/** 幂等启动：任意时刻最多一个 RAF 循环（重复调用/重复事件不会创建第二个循环）。 */
function play() {
  if (playing.value || duration.value <= 0) return
  playing.value = true
  lastFrameTs = null
  rafId = requestAnimationFrame(frame)
}

/** 幂等暂停：取消未完成的 RAF，绝不残留回调推进时间。 */
function pause() {
  playing.value = false
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

watch(() => props.seekTo, (sec) => {
  if (Number.isFinite(sec)) {
    pause() // 点击 AI 时间 → seek + 自动暂停（含取消 RAF）
    currentTime.value = Math.min(duration.value, Math.max(0, sec))
    eventPopupSec.value = Math.round(sec)
  }
}, { immediate: true })

function seek(sec) {
  currentTime.value = Math.min(duration.value, Math.max(0, sec))
  eventPopupSec.value = Math.round(sec)
}

function togglePlay() {
  if (playing.value) pause()
  else play()
}

/** 拖动进度条：按下即暂停，拖动中实时 seek，松开后保持暂停（不恢复拖动前状态）。 */
function dragStart() {
  pause()
}

/** 事件标记点击：跳转并保持暂停。 */
function jumpTo(sec) {
  pause()
  seek(sec)
}

function step(delta) {
  currentTime.value = Math.min(duration.value, Math.max(0, currentTime.value + delta))
}

function toggleSpeed() {
  speed.value = speed.value === 1 ? 2 : (speed.value === 2 ? 4 : 1)
}

function toggleType(type) {
  const next = new Set(typeFilter.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  typeFilter.value = next
}

onBeforeUnmount(() => {
  if (rafId != null) cancelAnimationFrame(rafId)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  pointers.clear()
  panStart = null
  pinchStart = null
  gestureMoved = false
  suppressClick = false
})

// ---- 数据 ----
const routesByAccount = computed(() => {
  const map = new Map()
  for (const route of props.overview.routes || []) map.set(route.accountId, route)
  return map
})

const vehiclesByAccount = computed(() => {
  const map = new Map()
  for (const vehicle of (playback.value ? playback.value.vehicles : [])) {
    map.set(vehicle.accountId, vehicle)
  }
  return map
})

const friendlyColors = computed(() => palette.value.friendlyColors)
const enemyColors = computed(() => palette.value.enemyColors)

function vehicleColor(vehicle) {
  const teamVehicles = vehicleStates.value
    .map(st => st.vehicle)
    .filter(v => v.team === vehicle.team)
  const index = teamVehicles.indexOf(vehicle)
  const list = vehicle.team === friendlyTeam.value ? friendlyColors.value : enemyColors.value
  return list[Math.max(0, index) % list.length]
}

/**
 * 车辆显示状态：把「当前可信插值位置」与「最后可信位置」分开——
 * gap 内禁止穿线插值，但车辆停在淡化最后已知位置，不整辆消失；
 * 阵亡后冻结在阵亡时刻的最后可信位置（优先于位置中断）。
 * covered 只表示服务器位置流覆盖（type-10），不是点亮。
 * direction = {hullYawDeg, turretRelativeYawDeg} | null：无可靠方向样本时不旋转（不伪造朝向）。
 */
function vehicleState(vehicle) {
  const route = routesByAccount.value.get(vehicle.accountId)
  const points = route ? route.points : []
  const t = currentTime.value
  const destroyed = vehicle.deathSec != null && t >= vehicle.deathSec
  const displayT = destroyed ? Math.min(t, vehicle.deathSec) : t
  const live = positionAt(points, displayT)
  const last = live ? live : lastKnownPosition(points, displayT)
  if (!last) return null // 从未有可信位置：不显示
  const covered = positionCoveredAt(vehicle.positionIntervals, t)
  const recorder = vehicle.accountId === props.overview.recorderAccountId
  const direction = interpolateDirection(vehicle.directionSamples, displayT)
  const friendly = vehicle.team === friendlyTeam.value
  // 阵亡：恒渲染 hull+turret 双层（方向冻结在最后可信样本；无样本以素材默认 0° 渲染，不代表真实朝向）；
  // 未阵亡：无可靠方向样本时不渲染车体（不伪造朝向），行为保持不变。
  const hullDeg = direction ? screenRotation(direction.hullYawDeg) : null
  const turretDeg = direction
    ? screenRotation(turretWorldYawDeg(direction.hullYawDeg, direction.turretRelativeYawDeg))
    : null
  return {
    vehicle,
    pos: last,
    covered,
    destroyed,
    recorder,
    friendly,
    direction,
    hullImage: friendly ? friendlyHull : enemyHull,
    turretImage: friendly ? friendlyTurret : enemyTurret,
    hullScreenDeg: destroyed ? (hullDeg == null ? 0 : hullDeg) : hullDeg,
    turretScreenDeg: destroyed ? (turretDeg == null ? 0 : turretDeg) : turretDeg,
    // lastKnown 表达「显示的是最后可信位置」（信息栏时间）；destroyed 是独立视觉状态，
    // 阵亡车信息栏同样显示最后可信时间，但视觉 class 不再套用 pb-last-known
    lastKnown: !live || !covered
  }
}

/** 标记水平位置（%）：地图用户坐标 → 容器百分比。 */
function markerLeft(x) {
  return `${((mapView.value.toX(x)) / mapView.value.W) * 100}%`
}

/** 标记垂直位置（%）。 */
function markerTop(y) {
  return `${((mapView.value.toY(y)) / mapView.value.H) * 100}%`
}

/** 历史路线前缀（只到当前时间；gap 断线；阵亡后不再延伸）。 */
function routeSegments(vehicle) {
  const route = routesByAccount.value.get(vehicle.accountId)
  if (!route) return []
  const stop = vehicle.deathSec != null
    ? Math.min(currentTime.value, vehicle.deathSec)
    : currentTime.value
  return routePrefix(route.points, stop)
}

const vehicleStates = computed(() => {
  const vehicles = playback.value ? playback.value.vehicles : []
  return vehicles.map(vehicleState).filter(Boolean)
})

const filteredEvents = computed(() => {
  const events = (playback.value ? playback.value.events : [])
    .filter(event => typeFilter.value.has(event.type))
  if (showAll.value) return events
  const recorderId = props.overview.recorderAccountId
  if (props.overview.arenaBonusType === 1 && recorderId != null) {
    return events.filter(event => recorderRelated(event, recorderId))
  }
  if (props.overview.arenaBonusType !== 1) {
    return events.filter(event => teamRelated(event, friendlyTeam.value, vehiclesByAccount.value))
  }
  return events
})

const eventMarkers = computed(() => aggregateEventsBySecond(filteredEvents.value))

// 炮线：仅来自过滤后事件流中的已知射击（DAMAGE/KILL），两端可信位置，随播放时间与倍速确定性呈现
const visibleTracers = computed(() => tracerLines(filteredEvents.value, routesByAccount.value, currentTime.value, speed.value))

function tracerColor(accountId) {
  const vehicle = vehiclesByAccount.value.get(accountId)
  return vehicle ? vehicleColor(vehicle) : palette.value.routeOutline
}

function nearestEvent(direction) {
  const events = filteredEvents.value
  if (!events.length) return
  const t = currentTime.value
  let best = null
  for (const event of events) {
    if (direction === 'prev' && event.timeSec < t - 0.1) {
      if (best === null || event.timeSec > best.timeSec) best = event
    } else if (direction === 'next' && event.timeSec > t + 0.1) {
      if (best === null || event.timeSec < best.timeSec) best = event
    }
  }
  if (best) {
    pause() // 上一/下一事件跳转后保持暂停
    currentTime.value = best.timeSec
    eventPopupSec.value = Math.round(best.timeSec)
  }
}

const popupEvents = computed(() => {
  if (eventPopupSec.value == null) return []
  return filteredEvents.value.filter(event => Math.round(event.timeSec) === eventPopupSec.value)
})

function playerName(accountId) {
  const vehicle = vehiclesByAccount.value.get(accountId)
  return vehicle ? (vehicle.playerName || `#${accountId}`) : (accountId == null ? t('recon.map.playback.unknown') : `#${accountId}`)
}

function eventLabel(event) {
  const type = t(`recon.map.playback.event_${event.type}`)
  switch (event.type) {
    case 'DAMAGE':
      return `${playerName(event.accountId)} → ${playerName(event.targetAccountId)} ${event.damage}`
    case 'KILL':
      return `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
    case 'DESTROYED':
      return playerName(event.accountId)
    case 'POSITION_REPORTED':
    case 'POSITION_STALE':
      return playerName(event.accountId)
    default:
      return type
  }
}

function selectVehicle(vehicle) {
  selectedAccountId.value = selectedAccountId.value === vehicle.accountId ? null : vehicle.accountId
}

const selectedState = computed(() => {
  if (selectedAccountId.value == null) return null
  return vehicleStates.value.find(st => st.vehicle.accountId === selectedAccountId.value) || null
})

const gridRegions = computed(() => {
  const regions = new Map()
  for (const cell of props.overview.gridCells || []) {
    const key = cell.nineGridRegion
    if (!regions.has(key)) {
      regions.set(key, { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity })
    }
    const r = regions.get(key)
    r.xMin = Math.min(r.xMin, cell.bounds.xMin)
    r.yMin = Math.min(r.yMin, cell.bounds.yMin)
    r.xMax = Math.max(r.xMax, cell.bounds.xMax)
    r.yMax = Math.max(r.yMax, cell.bounds.yMax)
  }
  return [...regions.entries()].sort((a, b) => a[0] - b[0])
})

const mapStyle = computed(() => ({
  '--map-grid-stroke': palette.value.gridStroke,
  '--map-region-stroke': palette.value.regionStroke,
  '--map-spawn-friendly': palette.value.spawnFriendly,
  '--map-spawn-enemy': palette.value.spawnEnemy,
  '--map-route-outline': palette.value.routeOutline,
  '--map-death-mark': palette.value.deathMark
}))
</script>

<template>
  <div v-if="image && playback" class="battle-playback" :style="mapStyle" data-test="battle-playback">
    <!-- 播放控制 -->
    <div class="pb-controls">
      <button type="button" class="pb-btn" data-test="pb-play" @click="togglePlay">
        {{ $t(playing ? 'recon.map.playback.pause' : 'recon.map.playback.play') }}
      </button>
      <button type="button" class="pb-btn" data-test="pb-back5" @click="step(-5)">-5s</button>
      <button type="button" class="pb-btn" data-test="pb-fwd5" @click="step(5)">+5s</button>
      <button type="button" class="pb-btn" data-test="pb-prev" @click="nearestEvent('prev')">◀</button>
      <button type="button" class="pb-btn" data-test="pb-next" @click="nearestEvent('next')">▶</button>
      <button type="button" class="pb-btn" data-test="pb-speed" @click="toggleSpeed">{{ speed }}×</button>
      <button type="button" class="pb-btn" data-test="pb-reset" @click="resetView">{{ $t('recon.map.playback.reset_view') }}</button>
      <span class="pb-time">{{ formatClock(currentTime) }} / {{ formatClock(duration) }}</span>
      <span v-if="overview.recorderAccountId != null" class="pb-filter">
        <label class="pb-check">
          <input type="checkbox" v-model="showAll" data-test="pb-all-events" />
          {{ $t('recon.map.playback.all_events') }}
        </label>
      </span>
    </div>

    <!-- 事件类型过滤 -->
    <div class="pb-filters">
      <button
        v-for="type in ['DAMAGE', 'DESTROYED', 'KILL', 'POSITION_REPORTED', 'POSITION_STALE']"
        :key="type"
        type="button"
        class="pb-chip"
        :class="{ active: typeFilter.has(type) }"
        @click="toggleType(type)"
      >{{ $t(`recon.map.playback.event_${type}`) }}</button>
    </div>

    <!-- 进度条 + 事件标记 -->
    <div class="pb-progress" data-test="pb-progress">
      <input
        class="pb-range"
        type="range"
        min="0"
        :max="duration || 1"
        step="0.1"
        :value="currentTime"
        @pointerdown="dragStart"
        @mousedown="dragStart"
        @touchstart="dragStart"
        @input="seek(Number($event.target.value))"
        :aria-label="$t('recon.map.playback.progress')"
      />
      <span
        v-for="marker in eventMarkers"
        :key="marker.sec"
        class="pb-marker"
        :style="{ left: `${duration > 0 ? (marker.sec / duration) * 100 : 0}%` }"
        :title="`${formatClock(marker.sec)} ×${marker.count}`"
        @click="jumpTo(marker.sec)"
      ></span>
    </div>

    <!-- 地图 + 当前车辆状态（标记为 HTML overlay，固定像素尺寸，双层 hull/turret 独立旋转） -->
    <div class="pb-map" data-test="pb-map" ref="mapEl" @wheel.prevent="onWheel">
    <div
      class="pb-viewport"
      data-test="pb-viewport"
      :style="viewportStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click.capture="onViewportClick"
    >
    <svg class="pb-svg" :viewBox="`0 0 ${mapView.W} ${mapView.H}`" role="img">
      <image :href="image.src" :width="mapView.W" :height="mapView.H" preserveAspectRatio="none" />
      <g class="pb-grid">
        <rect
          v-for="(cell, index) in overview.gridCells"
          :key="cell.id"
          :x="mapView.toX(cell.bounds.xMin)"
          :y="mapView.toY(cell.bounds.yMax)"
          :width="mapView.toX(cell.bounds.xMax) - mapView.toX(cell.bounds.xMin)"
          :height="mapView.toY(cell.bounds.yMin) - mapView.toY(cell.bounds.yMax)"
          class="pb-cell"
        />
      </g>
      <g class="pb-regions">
        <g v-for="[region, r] in gridRegions" :key="region">
          <rect
            :x="mapView.toX(r.xMin)"
            :y="mapView.toY(r.yMax)"
            :width="mapView.toX(r.xMax) - mapView.toX(r.xMin)"
            :height="mapView.toY(r.yMin) - mapView.toY(r.yMax)"
            class="pb-region-line"
          />
        </g>
      </g>
      <g class="pb-spawns">
        <circle
          v-for="(spawn, i) in overview.spawnPoints"
          :key="`${spawn.name}-${i}`"
          :cx="mapView.toX(spawn.x)"
          :cy="mapView.toY(spawn.y)"
          r="4"
          :class="spawn.team === friendlyTeam ? 'pb-spawn-friendly' : 'pb-spawn-enemy'"
        />
      </g>
      <g class="pb-routes">
        <template v-for="st in vehicleStates" :key="`route-${st.vehicle.accountId}`">
          <polyline
            v-for="(seg, i) in routeSegments(st.vehicle)"
            :key="`seg-${st.vehicle.accountId}-${i}`"
            class="pb-route"
            :stroke="vehicleColor(st.vehicle)"
            :points="seg.map(p => `${mapView.toX(p.x)},${mapView.toY(p.y)}`).join(' ')"
          />
        </template>
      </g>
      <g class="pb-tracers" aria-hidden="true">
        <line
          v-for="(l, i) in visibleTracers"
          :key="`tracer-${l.timeSec}-${i}`"
          class="pb-tracer"
          :x1="mapView.toX(l.x1)"
          :y1="mapView.toY(l.y1)"
          :x2="mapView.toX(l.x2)"
          :y2="mapView.toY(l.y2)"
          :stroke="tracerColor(l.attackerAccountId)"
          :opacity="l.opacity"
        />
      </g>
    </svg>
    <div class="pb-markers" data-test="pb-markers" aria-hidden="false">
      <button
        v-for="st in vehicleStates"
        :key="st.vehicle.accountId"
        type="button"
        class="pb-vehicle"
        :class="{ 'pb-last-known': st.lastKnown && !st.destroyed, 'pb-destroyed': st.destroyed, 'pb-recorder': st.recorder, 'pb-selected': selectedAccountId === st.vehicle.accountId }"
        :style="{ left: markerLeft(st.pos.x), top: markerTop(st.pos.y), transform: markerTransform }"
        :aria-label="`${st.vehicle.playerName}: ${$t(st.destroyed ? 'recon.map.playback.state_destroyed' : (st.covered ? 'recon.map.playback.state_position_reported' : 'recon.map.playback.state_position_stale'))}`"
        :data-test="`pb-marker-${st.vehicle.accountId}`"
        @click="selectVehicle(st.vehicle)"
      >
        <img
          v-if="st.hullScreenDeg != null"
          class="pb-hull"
          :src="st.hullImage"
          alt=""
          aria-hidden="true"
          :style="{ transform: `rotate(${st.hullScreenDeg}deg)` }"
        />
        <img
          v-if="st.turretScreenDeg != null"
          class="pb-turret"
          :src="st.turretImage"
          alt=""
          aria-hidden="true"
          :style="{ transform: `rotate(${st.turretScreenDeg}deg)` }"
        />
        <span v-if="st.destroyed" class="pb-death" aria-hidden="true">✕</span>
      </button>
    </div>
    </div>
    </div>

    <!-- 选中车辆信息 -->
    <div v-if="selectedState" class="pb-info" data-test="pb-info">
      <strong>{{ selectedState.vehicle.playerName }}</strong>
      <span>{{ $t('recon.map.playback.tank') }}: {{ selectedState.vehicle.tankName || selectedState.vehicle.tankId }}</span>
      <span>{{ $t('recon.map.playback.team') }}: {{ $t(`recon.map.playback.team_${selectedState.vehicle.team === friendlyTeam ? 'friendly' : 'enemy'}`) }}</span>
      <span>
        {{ $t('recon.map.playback.state') }}:
        {{ selectedState.destroyed
          ? $t('recon.map.playback.state_destroyed')
          : (selectedState.covered ? $t('recon.map.playback.state_position_reported') : $t('recon.map.playback.state_position_stale')) }}
      </span>
      <span v-if="selectedState.lastKnown">
        {{ $t('recon.map.playback.last_known') }} {{ formatClock(selectedState.pos.timeSec) }}
      </span>
    </div>

    <!-- 事件弹层（点击进度条标记展示该秒事件） -->
    <div v-if="popupEvents.length" class="pb-popup" data-test="pb-popup">
      <div class="pb-popup-head">
        {{ formatClock(eventPopupSec) }}
        <button type="button" class="pb-close" @click="eventPopupSec = null">&times;</button>
      </div>
      <ul>
        <li v-for="(event, i) in popupEvents" :key="i">
          <span class="pb-event-type">{{ $t(`recon.map.playback.event_${event.type}`) }}</span>
          {{ eventLabel(event) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.battle-playback {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.pb-controls, .pb-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pb-btn, .pb-chip {
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-label);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.pb-chip.active {
  background: var(--accent, #2f7dff);
  border-color: var(--accent, #2f7dff);
  color: #fff;
}
.pb-time { font-size: .8rem; color: var(--text-label); font-variant-numeric: tabular-nums; }
.pb-filter { display: inline-flex; align-items: center; gap: 4px; font-size: .78rem; }
.pb-check { display: inline-flex; align-items: center; gap: 4px; }
.pb-progress { position: relative; margin: 2px 0; }
.pb-range { width: 100%; display: block; }
.pb-marker {
  position: absolute;
  top: 2px;
  width: 3px;
  height: 10px;
  background: var(--accent, #2f7dff);
  cursor: pointer;
  transform: translateX(-50%);
}
.pb-map { position: relative; margin: 0 auto; width: 66.7%; overflow: hidden; }
.pb-viewport {
  position: relative;
  width: 100%;
  transform-origin: 0 0;
  touch-action: none;
}
.pb-svg {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 4px;
  background: #111;
}
@media (max-width: 768px) {
  .pb-map { width: 100%; }
}
.pb-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.pb-vehicle {
  position: absolute;
  width: 28px;
  height: 28px;
  transform: translate(-50%, -50%);
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  pointer-events: auto;
}
.pb-vehicle .pb-hull, .pb-vehicle .pb-turret {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.pb-vehicle .pb-hull { z-index: 1; }
.pb-vehicle .pb-turret { z-index: 2; }
@media (max-width: 768px) {
  .pb-vehicle { width: 22px; height: 22px; }
}
.pb-last-known { opacity: .3; }
.pb-destroyed { opacity: .35; }
.pb-destroyed .pb-hull, .pb-destroyed .pb-turret { filter: grayscale(1); }
.pb-recorder { filter: drop-shadow(0 0 3px #ffd76a); }
.pb-recorder::after {
  content: '';
  position: absolute;
  inset: -4px;
  border: 2px solid #ffd76a;
  border-radius: 50%;
  z-index: 3;
}
.pb-selected::before {
  content: '';
  position: absolute;
  inset: -3px;
  border: 2px solid #fff;
  border-radius: 50%;
  z-index: 3;
}
.pb-death {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  z-index: 4;
  pointer-events: none;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
}
.pb-cell { stroke: var(--map-grid-stroke, rgba(255,255,255,.16)); stroke-width: .5; fill: none; }
.pb-route { fill: none; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; opacity: .55; }
.pb-tracer { stroke-width: 1.5; stroke-linecap: round; }
.pb-region-line { fill: none; stroke: var(--map-region-stroke, rgba(255,255,255,.28)); stroke-width: 1; }
.pb-spawn-friendly { fill: var(--map-spawn-friendly, #8ef7b0); }
.pb-spawn-enemy { fill: var(--map-spawn-enemy, #ff8d8d); }

.pb-info {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: .8rem;
  color: var(--text-label);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
}
.pb-popup {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: .8rem;
}
.pb-popup-head { display: flex; justify-content: space-between; font-weight: 700; }
.pb-popup ul { margin: 4px 0 0; padding-left: 16px; }
.pb-event-type { color: var(--accent); margin-right: 4px; }
.pb-close { border: none; background: none; cursor: pointer; color: var(--text-muted); }
</style>
