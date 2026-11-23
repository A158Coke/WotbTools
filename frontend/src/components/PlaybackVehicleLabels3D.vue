<script setup>
import { ref, shallowRef, watch } from 'vue'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'
import TankClassIcon from './TankClassIcon.vue'
import { LABEL_OCCLUDED_OPACITY } from '../utils/labelLayout.js'

const props = defineProps({
  labelPrefs: { type: Object, required: true },
  gunMarks: { type: Map, default: () => new Map() },
  hpPrefs: { type: Object, required: true },
  markerPrefs: { type: Object, default: () => ({ classIcons: false }) },
  selectedEid: { type: Number, default: null },
  hidden: Boolean,
  /** drawing mode 下关闭 overlay 内唯一的可交互点（class icon），避免抢走/选中。 */
  interactive: { type: Boolean, default: true },
  /** 「最后已知」标记文案（离场坦克幽灵名牌；空串 = 不显示标记小字） */
  lastKnownLabel: { type: String, default: '' },
  /** 战场快捷标记来源卡的动作章文案（kind/intent → 本地化短标签；owner = Replay3DPane） */
  markerKindLabels: { type: Object, default: null },
})
const emit = defineEmits(['select'])
// Only this child receives 10 Hz content snapshots. Screen coordinates bypass
// Vue entirely: Three.js moves a bounded set of DOM anchors at render speed.
const labels = shallowRef([])
const elements = new Map()
const anchors = new Map()
// 战场快捷标记来源卡（battleMarkerHost → labelsRuntime 投影）：与坦克名牌**同一 DOM 卡片**
// （PlaybackVehicleLabel，屏幕空间恒定大小，不随距离缩放）；key = 标记事件稳定 id。
const markerLabels = shallowRef([])
const markerEls = new Map()
const markerAnchors = new Map()
// 伤害数字（"-342"）与名牌同层：canvas sprite 恒在 DOM 之下，跨层避让（renderOrder /
// 世界空间偏移）怎么算都会被名牌压住——同层后落点直接读血条 DOM 几何（px），
// 不存在世界↔屏幕换算，也不存在"永远被 DOM 盖住"。
const rootEl = ref(null)
const damages = shallowRef([])
let damageSeq = 0
/** 名牌内容发布序号：布局失效签名的一部分（行内容变化可能改变名牌块几何）。 */
let labelsSeq = 0
/** 血条右缘 ↔ 数字左缘的间隙：贴着血条读数，又不压住血条本身。 */
const DMG_GAP_PX = 8
/** 没有血条也没有名牌内容时的回退抬升（锚点 = 名牌块底边，即车辆模型上方）。 */
const DMG_FALLBACK_LIFT_PX = 20
/** 同一辆车短时间内连续受击：向下错开槽位，避免多个数字完全重叠到读不出。 */
const DMG_STACK_PX = 20
const DMG_STACK_SLOTS = 3
/**
 * 生命周期内的水平漂移距离（px，方向由所在侧决定）。唯一事实源在 JS：fit 计算必须把
 * 漂移行程算进去，CSS 只消费 `--pb-damage-drift-x`（组件内不再写第二份数值）。
 */
const DMG_DRIFT_PX = 20
const SIDE_RIGHT = 'right'
const SIDE_LEFT = 'left'
// 软遮挡下限的唯一来源在 utils/labelLayout.js；这里只做「常量 → CSS 变量」投影，
// CSS 不再自带数值（否则同一契约又散成两处）。
const occludedStyle = { '--pb-label-occluded-opacity': String(LABEL_OCCLUDED_OPACITY) }
/** display:none 恢复会重启 CSS timeline：幽灵段按壁钟 age 续上，不从头再播。 */
function syncGhostPhase(host) {
  const ghost = host.querySelector('.pb-hp-ghost')
  const bornMs = Number(ghost?.dataset.bornMs)
  if (Number.isFinite(bornMs)) ghost.style.animationDelay = `${-Math.max(0, performance.now() - bornMs)}ms`
}
function paint(el, anchor, forceReappearing = false) {
  if (!el || !anchor) return
  // 准备阶段先解除 hidden 后，写阶段不能再靠 el.hidden 判断「从隐藏恢复」；
  // forceReappearing 记录本帧曾隐藏，幽灵段仍按壁钟续播一次。
  const reappearing = (el.hidden || forceReappearing) && anchor.visible
  setHidden(el, !anchor.visible)
  if (!anchor.visible) return
  el.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -100%)`
  el.classList.toggle('label-occluded', !!anchor.occluded)
  if (reappearing) syncGhostPhase(el)
}
function bind(eid, el) {
  if (el) { elements.set(eid, el); paint(el, anchors.get(eid)) }
  else elements.delete(eid)
}
/** 来源身份单行文案：「玩家 · 车名」（空项不占位，与事件流 actorText 同一纪律）。 */
function markerActor(row) {
  return [row.player, row.tank].filter(Boolean).join(' · ')
}
function markerKindLabel(row) {
  const map = props.markerKindLabels
  if (!map) return ''
  if (row.kind === 'target' && row.intent) {
    // target 类 = **单行来源标注**：`{发起者} 要求攻击/要求撤退 {目标车型}`（不重复
    // 目标自己的玩家/坦克，也没有第二块身份卡 → 卡片更矮、能贴近目标而不压名牌）。
    // 模板条目允许函数（Replay3DPane 用 i18n 动态插值）或含 {who}/{target} 的字符串。
    const base = map[row.intent] || ''
    const who = markerActor(row)
    const entry = map[`target_${row.intent}`]
    if (entry && who && row.target) {
      if (typeof entry === 'function') return entry(row.target, who)
      return String(entry).replace('{who}', who).replace('{target}', row.target)
    }
    // 来源或目标缺一：仍不伪造——只拼已有事实
    if (who) return base ? `${who} · ${base}` : who
    return row.target ? `${base} · ${row.target}` : base
  }
  return (row.kind && map[row.kind]) || ''
}
function bindMarker(key, el) {
  if (el) { markerEls.set(key, el); paintMarker(markerEls.get(key), markerAnchors.get(key)) }
  else markerEls.delete(key)
}
function stackOffsetPx(stack) { return (stack % DMG_STACK_SLOTS) * DMG_STACK_PX }
/**
 * 布局失效签名：只列**会改变名牌 DOM 结构 / 尺寸**的状态（行开关、图标模式、名牌是否显示、
 * 覆盖层是否隐藏、名牌内容发布序号）。车辆每帧移动不在其中——屏幕位置每帧由当前 anchor
 * 重算，不需要也不允许因此重新量 DOM。
 */
function damageLayoutKey(anchorVisible) {
  return [
    anchorVisible ? 1 : 0,
    props.hidden ? 1 : 0,
    props.hpPrefs?.showHp ? 1 : 0,
    props.labelPrefs?.showPlayerName ? 1 : 0,
    props.labelPrefs?.showTankName === false ? 0 : 1,
    props.labelPrefs?.showReload ? 1 : 0,
    props.markerPrefs?.classIcons ? 1 : 0,
    labelsSeq,
  ].join('|')
}
/**
 * 量一块伤害数字**相对名牌锚点**的局部布局：血条可见 → 右缘 + `DMG_GAP_PX`、垂直居中于血条；
 * 血条关掉但名牌仍在 → 名牌块右缘同一规则；两者都没有（关名牌 / 真实 0×0 空名牌）→ 锚点上方
 * `DMG_FALLBACK_LIFT_PX`（锚点 = 名牌块底边，场景侧已按车体抬升，见 labelLiftWorld）。
 * 缓存的是几何（dx/dy/textW），不是屏幕坐标：屏幕坐标每帧按当前 anchor 重算。
 * @returns {{dxRight:number,dxLeft:number,dy:number,textW:number}|null} null = 现在还量不到（下一帧再试）
 */
function measureDamageLayout(eid, el, stack, anchorVisible) {
  if (props.hidden) return null            // 整层隐藏（隐藏全部 UI）：不可测，也不缓存成兜底布局
  const textW = el?.offsetWidth || 0
  // 兜底布局 = 锚点正上方，向左镜像时就贴锚点左侧
  const fallback = { dxRight: 0, dxLeft: -textW, dy: -DMG_FALLBACK_LIFT_PX + stackOffsetPx(stack), textW }
  if (!anchorVisible) return fallback      // 关名牌：数字是战斗反馈而非名牌内容，仍要显示
  const host = elements.get(eid)
  if (!host) return null                   // 行 DOM 还没 patch：下一帧再量（不能用错位置）
  const hostRect = host.getBoundingClientRect()
  const target = (host.querySelector('.pb-hp-bar') || host.querySelector('.vehicle-label'))?.getBoundingClientRect()
  // 真实 0×0 是**合法**的空名牌（姓名 / 车型 / HP / 装填全关、非图标模式）→ 兜底，不是"还没 ready"
  if ((!hostRect.width && !hostRect.height) || !target || (!target.width && !target.height)) return fallback
  // hostRect / target 是视口坐标，锚点坐标是覆盖层坐标——这里只量"相对锚点"的偏移，
  // 每帧由 placeDamages 加上当前 anchor 才是覆盖层内的落点（两坐标空间同原点，见 Replay3DPane.pb-stage）
  const baseX = hostRect.left + hostRect.width / 2
  const baseY = hostRect.bottom
  return {
    dxRight: target.right + DMG_GAP_PX - baseX,
    dxLeft: target.left - DMG_GAP_PX - textW - baseX,
    dy: target.top + target.height / 2 - baseY + stackOffsetPx(stack),
    textW,
  }
}
/**
 * 按**当前** anchor.x 与舞台宽度选侧：当前这一侧放不下（含整段漂移行程）才允许翻到另一侧，
 * 两侧都放不下时保持当前侧（出生点优先贴血条读数，viewport 裁切不可避免时不做往返抖动）。
 * 滞回（保持当前侧直到真的放不下）是必须的：车辆停在舞台右缘时，逐帧重判会让数字左右跳。
 */
function resolveDamageSide(layout, anchorX, stageW, current) {
  const fitsRight = stageW <= 0 || anchorX + layout.dxRight + layout.textW + DMG_DRIFT_PX <= stageW
  const fitsLeft = anchorX + layout.dxLeft - DMG_DRIFT_PX >= 0
  if (current === SIDE_LEFT) return fitsLeft || !fitsRight ? SIDE_LEFT : SIDE_RIGHT
  return fitsRight || !fitsLeft ? SIDE_RIGHT : SIDE_LEFT
}
/** hidden 只在真正变化时写：每帧一次 display 变更会让后续几何读取次次触发同步布局。 */
function setHidden(el, hidden) { if (el.hidden !== hidden) el.hidden = hidden }
/**
 * 一帧的锚点落位批处理：labelsRuntime 先 `beginAnchors(逻辑舞台)`，逐车 `setAnchor`
 * 只做同步拷贝/收集，最后 `endAnchors()` 统一 flush。读阶段（offsetWidth /
 * getBoundingClientRect）与写阶段（transform / class / hidden）严格分开：先集中准备
 * 需要重新量的伤害节点，再集中读 dirty 几何，最后统一写 DOM——不再逐车「写→读→写」
 * 触发同步布局。舞台宽度由调用方传入（renderer.getSize 的逻辑像素），覆盖层不读
 * rootEl.clientWidth。
 */
function flushAnchors(eids, stageW) {
  const list = damages.value
  if (!list.length) {
    for (const eid of eids) paint(elements.get(eid), anchors.get(eid))
    return
  }
  // 准备阶段解除 hidden 的宿主；写阶段据此保留 paint 的「重现」语义（幽灵段续播）。
  const preShownHosts = new Set()
  // 1) 准备：需要重新量的宿主必须先真正解除 hidden，否则 offsetWidth / rect 全为 0。
  // 车辆从屏外重入、或数字存活期间重开名牌时，anchor 已 visible 但宿主还停在上帧的 hidden；
  // 不先显示名牌宿主，measureDamageLayout 会读到 0×0 并把 fallback 缓存下来。
  for (const eid of eids) {
    const anchor = anchors.get(eid)
    if (!anchor?.projected) continue
    const host = elements.get(eid)
    if (host && anchor.visible) {
      if (host.hidden) preShownHosts.add(eid)
      setHidden(host, false)
    }
    const key = damageLayoutKey(!!anchor.visible)
    for (const d of list) {
      if (d.eid !== eid || !d.el) continue
      if (!d.layout || d.layoutKey !== key) setHidden(d.el, false)
    }
  }
  // 2) 读：每个 dirty 数字只量一次几何（所有写操作都排在这一阶段之后）。
  for (const eid of eids) {
    const anchor = anchors.get(eid)
    if (!anchor?.projected) continue
    const key = damageLayoutKey(!!anchor.visible)
    for (const d of list) {
      if (d.eid !== eid || !d.el) continue
      if (d.layout && d.layoutKey === key) continue
      const layout = measureDamageLayout(eid, d.el, d.stack, !!anchor.visible)
      if (layout) {
        d.layout = layout
        d.layoutKey = key
        d.layoutPending = false
      } else {
        // 行 DOM 还没 patch：本帧不定位（不能用错位置），下一帧重试。
        d.layoutPending = true
      }
    }
  }
  // 3) 写：名牌锚点 + 伤害数字统一落 DOM。
  for (const eid of eids) {
    const anchor = anchors.get(eid)
    paint(elements.get(eid), anchor, preShownHosts.has(eid))
    if (!anchor) continue
    const projected = !!anchor.projected
    for (const d of list) {
      if (d.eid !== eid || !d.el) continue
      // 车辆出屏 / 车体不可见：立刻隐藏，旧坐标不得继续显示（下一帧回来再按新 anchor 落位）
      if (!projected) {
        d.wasProjected = false // 包括出生时就在视野外：首次进屏也必须消费已过寿命
        d.layoutPending = false
        setHidden(d.el, true)
        continue
      }
      if (d.layoutPending || !d.layout) {
        setHidden(d.el, true)
        continue
      }
      setHidden(d.el, false)
      const side = resolveDamageSide(d.layout, anchor.x, stageW, d.side)
      if (side !== d.side) {
        d.side = side
        // 漂移方向必须**离开**血条：左侧镜像后若继续向右漂，后段会重新撞回血条
        applyDamageDrift(d)
      }
      if (d.wasProjected === false) syncDamageAnimationPhase(d)
      d.wasProjected = true
      const dx = side === SIDE_LEFT ? d.layout.dxLeft : d.layout.dxRight
      d.el.style.transform = `translate3d(${anchor.x + dx}px, ${anchor.y + d.layout.dy}px, 0)`
    }
  }
}
function applyDamageDrift(d) {
  if (!d.el || !d.side) return
  d.el.style.setProperty('--pb-damage-drift-x', `${d.side === SIDE_LEFT ? -DMG_DRIFT_PX : DMG_DRIFT_PX}px`)
}
function syncDamageAnimationPhase(d) {
  const text = d.el?.querySelector('.pb-damage-text')
  if (!text) return
  const age = Math.max(0, performance.now() - d.bornMs)
  text.style.animationDuration = `${d.durationMs}ms`
  text.style.animationDelay = `${-age}ms`
}
// 根节点 display:none 会重启 CSS timeline；DOM patch 后按原始壁钟恢复，不改到期 timer。
watch(() => props.hidden, (hidden, previous) => {
  if (previous === true && hidden === false) {
    for (const d of damages.value) syncDamageAnimationPhase(d)
    for (const el of elements.values()) syncGhostPhase(el)
  }
}, { flush: 'post' })
function bindDamage(d, el) {
  if (!el) { d.el = null; return }
  if (d.el === el) return      // 同一节点：inline ref 回调在每次 patch 重跑
  d.el = el
  applyDamageDrift(d)
}
/**
 * 生成一个伤害数字：场景内核在伤害事件跨过播放时钟时调用一次。
 * 生命周期 = 壁钟 `durationMs`（与 2D 同语义：暂停也自然走完）；漂移 / 淡出 / 不透明度
 * 全在 CSS 动画里；seek 由 `clearDamages` 清空且不补播。
 */
function spawnDamage(eid, hpLoss, durationMs) {
  const id = ++damageSeq
  const occupied = new Set(damages.value.filter((d) => d.eid === eid).map((d) => d.stack))
  let stack = 0
  while (stack < DMG_STACK_SLOTS && occupied.has(stack)) stack++
  // 三槽全满时沿用有界叠放；存在空槽时优先复用，避免旧数字到期后重复占槽。
  if (stack === DMG_STACK_SLOTS) stack = 0
  damages.value = [...damages.value, {
    id, eid, stack, text: '-' + hpLoss, bornMs: performance.now(), durationMs,
    layout: null, layoutKey: null, side: null, el: null, wasProjected: null, layoutPending: false,
  }]
  // 到期摘除走定时器而不是渲染循环：数字是 DOM，暂停时不需要（也不该依赖）场景继续出帧。
  // 非法寿命（NaN / ≤0）也要摘除——宁可短促，也不能把数字永远留在屏幕上。
  setTimeout(() => removeDamage(id), Math.max(1, Number(durationMs) || 0))
  return id
}
function removeDamage(id) {
  const next = damages.value.filter((d) => d.id !== id)
  if (next.length === damages.value.length) return
  damages.value = next
}
function clearDamages() { damages.value = [] }
/** 每个 entry 的时长稳定不变（rerender 只重写同一个值），动画 timeline 不被重新快进。 */
function damageAnimStyle(d) { return { animationDuration: `${d.durationMs}ms` } }
/** 批处理状态：labelsRuntime 逐帧 begin(stage) → setAnchor（只收集）→ end（统一 flush）。 */
let batchingAnchors = false
let batchStageW = 0
const batchEids = []
/** 契约：**同步拷贝**进自有 per-eid 存储，不持有调用方对象引用——场景内核逐帧逐车
 * 复用同一个 scratch 对象喂所有 eid（60Hz ×14 个对象的分配热路径），若这里存引用，
 * 全部 eid 会共享最后一辆车的坐标。 */
function copyAnchor(eid, anchor) {
  let cur = anchors.get(eid)
  if (!cur) { cur = { x: 0, y: 0, visible: false, occluded: false, projected: false }; anchors.set(eid, cur) }
  cur.x = anchor.x; cur.y = anchor.y; cur.visible = anchor.visible; cur.occluded = anchor.occluded
  // projected = 车辆在视锥内（与"名牌是否显示"无关）：关名牌时伤害数字仍有落点
  cur.projected = anchor.projected ?? anchor.visible
  return cur
}
/**
 * 开始一帧的锚点批处理。stage = 渲染器逻辑视口（CSS px），作为伤害数字贴边镜像的
 * 唯一舞台宽度来源；覆盖层不再读 rootEl.clientWidth。
 */
function beginAnchors(stage) {
  batchingAnchors = true
  batchEids.length = 0
  batchStageW = Number.isFinite(stage?.x) ? stage.x : 0
}
/** 结束本帧批处理：集中读 dirty 几何后统一写 DOM。 */
function endAnchors() {
  if (!batchingAnchors) return
  batchingAnchors = false
  flushAnchors(batchEids, batchStageW)
  batchEids.length = 0
}
function setAnchor(eid, anchor, stage) {
  copyAnchor(eid, anchor)
  if (batchingAnchors) { batchEids.push(eid); return }
  // 单条兼容路径（旧桩/测试）：显式 stage 优先，否则沿用最近一次 begin 的舞台宽度。
  flushAnchors([eid], Number.isFinite(stage?.x) ? stage.x : batchStageW)
}
function setLabels(rows) { labels.value = rows; labelsSeq++ }
function setMarkerLabels(rows) { markerLabels.value = rows }
function setMarkerAnchor(key, anchor) {
  // 契约与 setAnchor 相同：**同步拷贝**（labelsRuntime 逐帧复用同一个 scratch 对象）
  let cur = markerAnchors.get(key)
  if (!cur) { cur = { x: 0, y: 0, visible: false, opacity: 1 }; markerAnchors.set(key, cur) }
  cur.x = anchor.x; cur.y = anchor.y; cur.visible = anchor.visible !== false
  cur.opacity = anchor.opacity ?? 1
  paintMarker(markerEls.get(key), cur)
}
/** marker 卡专用重摆：与 paint 同一 transform/hidden，另随标记本体末段淡出渐进透明
 *  （opacity 由 labelsRuntime 从 runtime fade 系数桥接；0 < fade < 1 不在端点瞬失）。 */
function paintMarker(el, anchor) {
  if (!el || !anchor) return
  el.hidden = !anchor.visible
  el.style.opacity = String(anchor.opacity)
  el.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(-50%, -100%)`
}
function clear() {
  labels.value = []; anchors.clear(); elements.clear()
  markerLabels.value = []; markerEls.clear(); markerAnchors.clear()
  batchingAnchors = false; batchEids.length = 0; batchStageW = 0
  clearDamages()
}
defineExpose({ setLabels, setAnchor, beginAnchors, endAnchors, clear, spawnDamage, removeDamage, clearDamages, setMarkerLabels, setMarkerAnchor })
</script>

<template>
  <div ref="rootEl" class="vehicle-label-overlay" :class="{ 'label-layer-static': !props.interactive }" :hidden="hidden" :style="occludedStyle" data-testid="vehicle-label-overlay">
    <div v-for="row in labels" :key="row.eid" :ref="el => bind(row.eid, el)"
      class="vehicle-label-anchor" :data-eid="row.eid" hidden>
      <PlaybackVehicleLabel
        :player-name="row.playerName" :tank-name="row.tankName" :gun-marks="gunMarks.get(row.accountId)" :friendly="row.friendly"
        :destroyed="row.destroyed" :last-known="row.lastKnown" :last-known-label="lastKnownLabel" :hp="row.hp" :reload="row.reload"
        :consumables="row.consumables"
        :hp-ghost="row.hpGhost" :hp-flash="row.hpFlash" :hp-no-transition="true"
        :show-player-name="labelPrefs.showPlayerName" :show-tank-name="labelPrefs.showTankName"
        :show-hp="hpPrefs.showHp" :show-reload="labelPrefs.showReload"
      />
      <button v-if="markerPrefs.classIcons" type="button" class="vehicle-class-button"
        :class="{ 'is-friendly': row.friendly === true, 'is-enemy': row.friendly === false, 'is-destroyed': row.destroyed }"
        :aria-label="row.tankName" :aria-pressed="selectedEid === row.eid"
        @pointerdown.stop @click.stop="emit('select', row.eid, $event)">
        <TankClassIcon :tank-class="row.tankClass" />
      </button>
    </div>
    <!-- 战场快捷标记来源卡：与坦克名牌同一卡片组件（恒定像素大小，不随距离缩放）。
         内容 = 下发玩家 + 坦克（0x2e 联名册 def / 0x2f sender 联册，联不到只出玩家行）。 -->
    <div v-for="row in markerLabels" :key="row.key" :ref="el => bindMarker(row.key, el)"
      class="vehicle-label-anchor battle-marker-anchor" :data-marker="row.key" :data-target="row.target || null" hidden>
      <!-- 动作章：target 类 = 「要求攻击/要求撤退 {目标车型}」；身份两行 = 标注**来源**
           （卡读作「{发起者} 要求攻击/撤退 {目标车型}」）。目标自己的玩家/坦克/血量由车辆
           名牌负责，卡片不再重复，并在 labelsRuntime 里整体上移避开目标名牌。 -->
      <p v-if="markerKindLabel(row)" class="battle-marker-kind" :data-kind="row.kind === 'target' ? row.intent : row.kind" aria-hidden="true">{{ markerKindLabel(row) }}</p>
      <!-- 身份两行 = 来源（开关 = 战场快捷标记总开关，不随名牌行偏好隐藏）；target 类已
           在动作章里单行给出「发起者 + 目标车型」，不再叠第二块身份卡。 -->
      <PlaybackVehicleLabel
        v-if="row.kind !== 'target' && (row.player || row.tank)"
        :player-name="row.player" :tank-name="row.tank" :friendly="null"
        :show-player-name="true" :show-tank-name="true"
        :show-hp="false" :show-reload="false"
      />
    </div>
    <!-- 伤害数字排在所有名牌之后：同层内 DOM 顺序即层级，数字永远不会被名牌盖住。
         初始 hidden，由 placeDamages 量到落点后再显示（避免在覆盖层原点闪一帧）。
         战斗反馈不受状态标记偏好控制，只随覆盖层根节点 hidden（隐藏全部 UI）消失。 -->
    <div class="pb-damage-layer" aria-hidden="true">
      <span v-for="d in damages" :key="d.id" :ref="el => bindDamage(d, el)"
        class="pb-damage" data-test="pb-damage" hidden>
        <span class="pb-damage-text" :style="damageAnimStyle(d)">{{ d.text }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.vehicle-label-overlay { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: var(--pb-z-canvas); }
.vehicle-label-overlay[hidden], .vehicle-label-anchor[hidden] { display: none; }
/* 3D 覆盖层：名牌卡不用 backdrop-filter。它背后的画布每帧都在变，磨砂玻璃会让合成器
   每帧对 14 块名牌重新采样并模糊底下的 WebGL 画面——1440p 实测帧间隔 p50 32.9 ms
   （15 个 >50 ms 帧），去掉后 16.0 ms；而同窗口场景自身的 GPU 主 pass 只有 ~9 ms、
   animate 总计 ~4 ms。代价是失去「磨砂玻璃」质感，改用更实的平面底色（比 2D 的 45%
   磨砂底高一档）压住亮地形；2D 战术图是静态底图，仍用 PlaybackVehicleLabel 的磨砂呈现。 */
.vehicle-label-overlay :deep(.pb-labels) {
  backdrop-filter: none;
  background: color-mix(in oklab, var(--color-canvas) 58%, transparent);
}
.vehicle-label-overlay.label-layer-static .vehicle-class-button { pointer-events: none; }
.vehicle-label-anchor { position: absolute; left: 0; top: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; }
.vehicle-label-anchor:not([hidden]) { will-change: transform; }
/* 战场快捷标记来源卡的动作章：目标类卡（攻击/撤退）必须自述"对它做什么"——
   在目标车上悬浮发起者名牌会与目标自己的名牌混淆（用户反馈"撤退表现逻辑不对"）。 */
.battle-marker-kind {
  margin: 0 0 2px;
  padding: 1px 10px;
  border-radius: var(--radius-full);
  corner-shape: round;
  background: color-mix(in oklab, var(--color-canvas) 72%, transparent);
  color: var(--color-text-primary);
  font: var(--type-caption);
  white-space: nowrap;
}
.label-occluded { opacity: var(--pb-label-occluded-opacity, .35); }
/* 伤害数字：血条右侧的战斗反馈数字。屏幕尺寸固定 px（远近缩放与自由/跟随/俯视镜头下
   视觉大小一致），深色描边保证任意地形 / 车体上都读得出，出生阶段 100% 不透明、
   只在后半程淡出；漂移 = 水平 20px（方向由 JS 按所在侧写 `--pb-damage-drift-x`，
   保证始终远离血条）+ 垂直 24px（--space-6），合计约 31px（契约 20~35px）。 */
.pb-damage-layer { position: absolute; inset: 0; pointer-events: none; }
/* 定位前的兜底值：元素此时还是 hidden（placeDamages 就位时才显示），不会以 0 漂移露一帧 */
.pb-damage { position: absolute; left: 0; top: 0; --pb-damage-drift-x: 0px; }
.pb-damage[hidden] { display: none; }
.pb-damage-text {
  display: block;
  color: var(--color-playback-damage-text);
  font: var(--type-caption);
  font-size: var(--font-size-h3);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-shadow: var(--text-shadow-playback-damage);
  transform: translate(0, -50%);
  animation: pb-damage-rise linear forwards;
}
@keyframes pb-damage-rise {
  0% { transform: translate(0, -50%); opacity: 1; }
  50% { opacity: 1; }
  100% { transform: translate(var(--pb-damage-drift-x), calc(-50% - var(--space-6))); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .pb-damage-text { animation: none; }
}
.vehicle-class-button {
  display: grid;
  place-items: center;
  min-inline-size: var(--hit-min);
  min-block-size: var(--hit-min);
  padding: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-team-neutral);
  pointer-events: auto;
  cursor: pointer;
}
.vehicle-class-button :deep(path) { stroke: var(--color-canvas); stroke-width: 1; paint-order: stroke; }
.vehicle-class-button.is-friendly { color: var(--color-team-ally); }
.vehicle-class-button.is-enemy { color: var(--color-team-enemy); }
.vehicle-class-button.is-destroyed { color: var(--color-playback-label-destroyed); opacity: .55; }
.vehicle-class-button[aria-pressed="true"], .vehicle-class-button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: var(--space-1); }
</style>
