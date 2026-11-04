import { computed, reactive, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import {
  BURST_MS,
  FLOAT_DMG_MS,
  FLASH_MS,
  GHOST_MS,
  KILL_FEED_MS,
  activeFeed,
  eventsCrossed,
  pushFeed,
  transientsActive,
} from '../utils/battlePlayback.js'
import { ghostAroundV2, positionAtV2, victimFeedbackAllowedV2 } from '../utils/battlePlaybackV2.js'
import type { BattleEvent, DamageLoss, VehiclePlaybackTrack } from '../types/playback-v2.js'

interface PlaybackFloatItem {
  id: number
  victimAccountId: number
  hpLoss: DamageLoss['hpLoss']
  bornRealMs: number
  durationMs: number
}
interface PlaybackBurstItem {
  id: number
  victimAccountId: number
  bornRealMs: number
  durationMs: number
}
interface PlaybackFeedItem {
  id: number
  victimAccountId: BattleEvent['targetAccountId']
  victimPlayerName: string
  victimName: string
  victimFriendly: VehiclePlaybackTrack['friendly']
  bornRealMs: number
  durationMs: number
}

/** transient 消费链实际读取的 track 结构（结构性最小集，便于测试与调用方传参）。 */
export type TransientVehicleTrack = Pick<
  VehiclePlaybackTrack,
  'accountId' | 'positionSegments' | 'damageLosses' | 'playerName' | 'tankName' | 'tankId' | 'friendly'
>

/**
 * 2D 回放 transient feedback 的唯一 owner（#820 Wave B5A）：
 * event cursor + floating damage / destroy burst / kill feed 队列 + HP ghost/flash。
 *
 * 事实源分层（不复制 canonical data，不建第二个时钟）：
 * - 消费源 = authoritative playback events + canonical DamageLoss（数值伤害唯一权威）；
 * - 消费区间严格左开右闭 `(fromSec, toSec]`，eventCursor 防重复；
 * - transient 生命周期 = wall clock（performance.now），由调用方传入 `nowMs` 驱动——
 *   播放时 playback frame() 刷新，暂停时调用方的轻量 pause RAF 刷新；
 * - seek/回绕清空与 cursor 重置由调用方通过 {@link resetTransients} / 写 `eventCursor` 完成。
 *
 * 纯展示投影（屏幕定位）不在此处：`visibleFloats` / `visibleBursts` 依赖地图投影
 * `markerScreen`，仍由 BattlePlayback 消费 `floatItems` / `burstItems` 自行投影。
 */
export function usePlaybackTransients(options: {
  /** UI wall clock（performance.now 基准）；transient born/expire 与 pause pending 判定共用它。 */
  nowMs: Ref<number>
  /** authoritative playback events（不受 Event Panel 折叠过滤影响）。 */
  authoritativeEvents: () => BattleEvent[]
  /** canonical vehicle tracks（damageLosses / positionSegments 消费源）。 */
  hpVehicles: () => TransientVehicleTrack[]
  /** accountId → canonical vehicle identity（feed banner 显示字段来源）。 */
  vehiclesByAccount: () => Map<number, TransientVehicleTrack>
}) {
  const { nowMs } = options

  let transientSeq = 0
  const eventCursor = ref(0)
  const floatItems = ref<PlaybackFloatItem[]>([])
  const burstItems = ref<PlaybackBurstItem[]>([])
  const feedItems = ref<PlaybackFeedItem[]>([])
  // Event Banner 真实队列：id -> 展示起点 realMs（非响应式，避免 computed 副作用循环）。
  const feedShownAt = new Map<unknown, number>()
  const ghostByAccount = reactive(new Map<number, { prevPct: number; nextPct: number; untilRealMs: number }>())
  const flashByAccount = reactive(new Map<number, number>())

  function realNowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  /** seek/恢复：清空全部 transient 并重置事件 cursor（§20.1 不补播历史动画）。 */
  function resetTransients(sec: number) {
    eventCursor.value = sec
    floatItems.value = []
    burstItems.value = []
    feedItems.value = []
    feedShownAt.clear()
    ghostByAccount.clear()
    flashByAccount.clear()
  }

  /** 播放时钟跨过 (fromSec, toSec] 的新事件 → 生成 transient feedback（§10/§12/§16）。 */
  function consumeEvents(fromSec: number, toSec: number) {
    // 消费源 = authoritative playback events（不依赖事件列表 UI 过滤——
    // 「战斗事实有没有发生」不取决于 DAMAGE/KILL checkbox 是否显示）。
    // 左界 = max(fromSec, eventCursor)（严格左开 cursor：seek/回绕把 cursor 重置到新时间点后，
    // prev 滞后不会把旧时间点事件重复消费——loop 下一轮不重复上一轮末尾事件）。
    const damageLeft = Math.max(fromSec, eventCursor.value)
    const crossed = eventsCrossed(options.authoritativeEvents(), damageLeft, toSec)
    const damageCrossed = options.hpVehicles().some(track =>
      (track.damageLosses || []).some(loss => loss && loss.toSec > damageLeft + 1e-6 && loss.toSec <= toSec + 1e-6))
    if (crossed.length === 0 && !damageCrossed) {
      eventCursor.value = Math.max(eventCursor.value, toSec)
      return
    }
    const now = realNowMs()
    // 消费时刻资格判定：以**帧末 toSec** 的 canonical 位置为准，与 projectVehicleState 的
    // 排除谓词同源（positionAtV2 为空 = 该车尚未入场）。事件稀疏：逐 track 的 segment
    // 位置检查远轻于整表状态快照。
    const hasPositionAtConsumption = (track: TransientVehicleTrack) => positionAtV2(track.positionSegments, toSec) != null
    // DamageLoss is the sole numeric damage authority. Notification events below
    // remain responsible for lifecycle feedback only.
    for (const track of options.hpVehicles()) {
      for (const loss of track.damageLosses || []) {
        if (!loss || loss.toSec <= damageLeft + 1e-6 || loss.toSec > toSec + 1e-6) continue
        const victim = options.vehiclesByAccount().get(track.accountId)
        if (!victim || loss.transientAllowed !== true) continue
        if (!hasPositionAtConsumption(track)) continue
        floatItems.value.push({
          id: ++transientSeq,
          victimAccountId: track.accountId,
          hpLoss: loss.hpLoss,
          bornRealMs: now,
          durationMs: FLOAT_DMG_MS,
        })
        const g = ghostAroundV2(loss)
        if (g) ghostByAccount.set(track.accountId, { prevPct: g.prevPct, nextPct: g.nextPct, untilRealMs: now + GHOST_MS })
        flashByAccount.set(track.accountId, now + FLASH_MS)
      }
    }
    for (const ev of crossed) {
      if (ev.type === 'DAMAGE') {
        continue
      } else if (ev.type === 'DESTROYED') {
        // §12：击毁 burst（轻量 2D，克制；仅受击方位置流覆盖时锚定）
        const victimId = ev.accountId
        if (victimId == null) continue
        const victim = options.vehiclesByAccount().get(victimId)
        if (!victim || !victimFeedbackAllowedV2(victim, ev.timeSec)) continue
        if (!hasPositionAtConsumption(victim)) continue
        burstItems.value.push({
          id: ++transientSeq,
          victimAccountId: victimId,
          bornRealMs: now,
          durationMs: BURST_MS,
        })
      } else if (ev.type === 'KILL') {
        // §16 kill feed：只显示受害者被击毁（§15.2——回放只能证明后端事后解析
        // attackerAccountId，无法证明客户端当时可见击杀者身份，禁止伪造 "未知 ☠ IS-7"）。
        const victimId = ev.targetAccountId
        if (victimId == null) continue
        const victim = options.vehiclesByAccount().get(victimId)
        if (!victim) continue
        feedItems.value = pushFeed(feedItems.value, {
          id: ++transientSeq,
          victimAccountId: victimId,
          // §15：banner 使用 canonical vehicle identity（playerName + tankName），
          // 显示「玩家名（车辆名）被击毁」；不猜车型、不解析 label 字符串。
          victimPlayerName: victim.playerName || '',
          victimName: victim.tankName || String(victim.tankId),
          victimFriendly: victim.friendly,
          bornRealMs: now,
          durationMs: KILL_FEED_MS,
        })
      }
    }
    eventCursor.value = Math.max(eventCursor.value, toSec)
  }

  /** 暂停时 transient 是否仍有未决（驱动轻量时钟自然完成，§20.2）。 */
  function hasPendingTransients(now: number) {
    if (transientsActive(floatItems.value, now).length) return true
    if (transientsActive(burstItems.value, now).length) return true
    // Event Banner queue：以 shownAt 计时（activeFeed）。存在「排队等待」或「正在展示且未过期」的
    // 条目都算 pending —— pause 下也要完整展示 4s 并自然消失（不能按 bornRealMs 判断 feed）。
    if (feedItems.value.some(it => {
      const s = feedShownAt.get(it.id)
      return s == null || !Number.isFinite(it.durationMs) || now - s < it.durationMs
    })) return true
    for (const g of ghostByAccount.values()) if (g.untilRealMs > now) return true
    for (const u of flashByAccount.values()) if (u > now) return true
    return false
  }

  /** 过期 transient 清理（由 nowMs/currentTime 变化驱动，Map 不无限增长）。 */
  function pruneTransients(now: number) {
    for (const [id, g] of ghostByAccount) if (g.untilRealMs <= now) ghostByAccount.delete(id)
    for (const [id, u] of flashByAccount) if (u <= now) flashByAccount.delete(id)
    // Event Banner 队列：移除已完整展示并过期的条目及其 shownAt 记录；
    // 排队中（shownAt 空）的条目保留（待空位展示，不直接挤出）。
    feedItems.value = feedItems.value.filter(it => {
      const s = feedShownAt.get(it.id)
      return s == null || !Number.isFinite(it.durationMs) || now - s < it.durationMs
    })
    for (const id of [...feedShownAt.keys()]) {
      if (!feedItems.value.some(it => it.id === id)) feedShownAt.delete(id)
    }
  }

  function ghostFor(accountId: number) {
    const g = ghostByAccount.get(accountId)
    if (!g || g.untilRealMs <= nowMs.value) return null
    return { prevPct: g.prevPct, nextPct: g.nextPct }
  }
  function flashFor(accountId: number) {
    return (flashByAccount.get(accountId) || 0) > nowMs.value
  }

  // kill feed 可见投影：activeFeed 在展示空位出现时把排队条目提升为「正在展示」
  // （shownAt 副作用记录展示起点），feedItems 顺序即权威队列顺序。
  const visibleFeed: ComputedRef<PlaybackFeedItem[]> = computed(() =>
    activeFeed(feedItems.value, nowMs.value, feedShownAt))

  return {
    eventCursor,
    floatItems,
    burstItems,
    feedItems,
    resetTransients,
    consumeEvents,
    hasPendingTransients,
    pruneTransients,
    ghostFor,
    flashFor,
    visibleFeed,
  }
}
