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

export type TransientVehicleTrack = Pick<
  VehiclePlaybackTrack,
  'accountId' | 'positionSegments' | 'damageLosses' | 'playerName' | 'tankName' | 'tankId' | 'friendly'
>

export function usePlaybackTransients(options: {
  nowMs: Ref<number>
  authoritativeEvents: () => BattleEvent[]
  hpVehicles: () => TransientVehicleTrack[]
  vehiclesByAccount: () => Map<number, TransientVehicleTrack>
  feedVisible?: () => boolean
}) {
  const { nowMs } = options

  let transientSeq = 0
  const eventCursor = ref(0)
  const floatItems = ref<PlaybackFloatItem[]>([])
  const burstItems = ref<PlaybackBurstItem[]>([])
  const feedItems = ref<PlaybackFeedItem[]>([])
  const feedShownAt = new Map<unknown, number>()
  const ghostByAccount = reactive(new Map<number, { prevPct: number; nextPct: number; untilRealMs: number }>())
  const flashByAccount = reactive(new Map<number, number>())

  function realNowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  function resetTransients(sec: number) {
    eventCursor.value = sec
    floatItems.value = []
    burstItems.value = []
    feedItems.value = []
    feedShownAt.clear()
    ghostByAccount.clear()
    flashByAccount.clear()
  }

  function consumeEvents(fromSec: number, toSec: number) {
    const damageLeft = Math.max(fromSec, eventCursor.value)
    const crossed = eventsCrossed(options.authoritativeEvents(), damageLeft, toSec)
    const damageCrossed = options.hpVehicles().some(track =>
      (track.damageLosses || []).some(loss => loss && loss.toSec > damageLeft + 1e-6 && loss.toSec <= toSec + 1e-6))
    if (crossed.length === 0 && !damageCrossed) {
      eventCursor.value = Math.max(eventCursor.value, toSec)
      return
    }
    const now = realNowMs()
    const hasPositionAtConsumption = (track: TransientVehicleTrack) => positionAtV2(track.positionSegments, toSec) != null
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
        const victimId = ev.targetAccountId
        if (victimId == null) continue
        const victim = options.vehiclesByAccount().get(victimId)
        if (!victim) continue
        feedItems.value = pushFeed(feedItems.value, {
          id: ++transientSeq,
          victimAccountId: victimId,
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

  function hasPendingTransients(now: number) {
    if (transientsActive(floatItems.value, now).length) return true
    if (transientsActive(burstItems.value, now).length) return true
    const feedVisible = options.feedVisible?.() ?? true
    if (feedItems.value.some(it => {
      const s = feedShownAt.get(it.id)
      if (s == null) return feedVisible
      return !Number.isFinite(it.durationMs) || now - s < it.durationMs
    })) return true
    for (const g of ghostByAccount.values()) if (g.untilRealMs > now) return true
    for (const u of flashByAccount.values()) if (u > now) return true
    return false
  }

  function pruneTransients(now: number) {
    for (const [id, g] of ghostByAccount) if (g.untilRealMs <= now) ghostByAccount.delete(id)
    for (const [id, u] of flashByAccount) if (u <= now) flashByAccount.delete(id)
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
