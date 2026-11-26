import { firstIndexAfter } from '../seekPointer.js'

export interface DamageEvent {
  t: number
  eid: number
  hpLoss: number
  hpBefore: number
  hpAfter: number
}

export interface BurstEvent {
  t: number
  eid: number
}

export interface HpGhost {
  fromFrac: number
  toFrac: number
  bornMs: number
  untilMs: number
}

export interface TransientVehicle {
  def: { eid: number; max_hp: number; hp?: Array<[number, number]> }
  group: { visible: boolean }
}

export interface TransientData {
  vehicles?: Array<{ eid: number; hp?: Array<[number, number]> }>
  kills?: Array<{ t: number }>
}

export interface TransientLabelOverlay {
  spawnDamage?: (eid: number, hpLoss: number, durationMs: number) => void
  clearDamages?: () => void
}

export interface TransientBattleFx {
  clearTransients?: () => void
}

export interface TransientFeedback3dDeps {
  getData: () => TransientData | null
  getVehicles: () => TransientVehicle[]
  deathTimesOf: (v: TransientVehicle) => number[]
  getLabelOverlay: () => TransientLabelOverlay | null
  getBattleFx: () => TransientBattleFx | null
  invalidateLabels: () => void
  invalidate: () => void
  now?: () => number
  scale: number
  floatDmgMs: number
  ghostMs: number
  flashMs: number
  onBurst: (eid: number) => void
}

export interface TransientFeedback3d {
  rebuildSources: () => void
  resyncBursts: (t: number) => void
  rewind: (t: number) => void
  rewindBursts: (t: number) => void
  advanceTo: (t: number) => void
  updateNow: () => boolean
  clear: () => void
  ghostOf: (eid: number) => HpGhost | undefined
  hasFlash: (eid: number) => boolean
  hasActive: () => boolean
}

export function createTransientFeedback3d(deps: TransientFeedback3dDeps): TransientFeedback3d {
  const now = deps.now ?? (() => performance.now())
  const ghostByEid = new Map<number, HpGhost>()
  const flashByEid = new Map<number, number>()
  let dmgEvents: DamageEvent[] = []
  let burstEvents: BurstEvent[] = []
  let dmgPtr = 0
  let burstPtr = 0

  function vehicleByEid(eid: number): TransientVehicle | undefined {
    return deps.getVehicles().find((x) => x.def.eid === eid)
  }

  function buildBurstSources(): void {
    burstEvents = []
    for (const v of deps.getVehicles()) {
      for (const t of deps.deathTimesOf(v)) burstEvents.push({ t, eid: v.def.eid })
    }
    burstEvents.sort((a, b) => a.t - b.t)
  }

  function rebuildSources(): void {
    dmgEvents = []
    for (const def of deps.getData()?.vehicles || []) {
      const hp = def.hp || []
      for (let i = 1; i < hp.length; i++) {
        const loss = hp[i - 1][1] - hp[i][1]
        if (loss > 0) dmgEvents.push({ t: hp[i][0], eid: def.eid, hpLoss: loss, hpBefore: hp[i - 1][1], hpAfter: hp[i][1] })
      }
    }
    dmgEvents.sort((a, b) => a.t - b.t)
    const kills = deps.getData()?.kills
    if (kills) kills.sort((a, b) => a.t - b.t)
    buildBurstSources()
    dmgPtr = 0
    burstPtr = 0
  }

  function emitDamageFeedback(event: DamageEvent): void {
    const v = vehicleByEid(event.eid)
    if (!v || !v.group.visible) return
    deps.getLabelOverlay()?.spawnDamage?.(event.eid, event.hpLoss, deps.floatDmgMs * deps.scale)
    const nowMs = now()
    const maxHp = v.def.max_hp > 0 ? v.def.max_hp : 0
    if (maxHp > 0) {
      const fromFrac = Math.max(0, Math.min(1, event.hpAfter / maxHp))
      const prev = ghostByEid.get(event.eid)
      const carriedFrac = prev && nowMs < prev.untilMs ? prev.toFrac : 0
      const toFrac = Math.max(carriedFrac, Math.min(1, event.hpBefore / maxHp))
      ghostByEid.set(event.eid, { fromFrac, toFrac, bornMs: nowMs, untilMs: nowMs + deps.ghostMs * deps.scale })
    }
    flashByEid.set(event.eid, nowMs + deps.flashMs * deps.scale)
    deps.invalidateLabels()
  }

  function advanceTo(t: number): void {
    while (dmgPtr < dmgEvents.length && dmgEvents[dmgPtr].t <= t) {
      emitDamageFeedback(dmgEvents[dmgPtr++])
    }
    while (burstPtr < burstEvents.length && burstEvents[burstPtr].t <= t) {
      deps.onBurst(burstEvents[burstPtr++].eid)
    }
  }

  function updateNow(): boolean {
    const nowMs = now()
    let changed = false
    for (const [eid, g] of ghostByEid) {
      if (nowMs >= g.untilMs) {
        ghostByEid.delete(eid)
        deps.invalidateLabels()
        deps.invalidate()
        changed = true
      }
    }
    for (const [eid, until] of flashByEid) {
      if (nowMs >= until) {
        flashByEid.delete(eid)
        deps.invalidateLabels()
        deps.invalidate()
        changed = true
      }
    }
    return changed
  }

  function clear(): void {
    deps.getLabelOverlay()?.clearDamages?.()
    deps.getBattleFx()?.clearTransients?.()
    ghostByEid.clear()
    flashByEid.clear()
    dmgPtr = 0
    burstPtr = 0
  }

  function resyncBursts(t: number): void {
    buildBurstSources()
    burstPtr = firstIndexAfter(burstEvents, t)
  }

  function rewind(t: number): void {
    dmgPtr = firstIndexAfter(dmgEvents, t)
    burstPtr = firstIndexAfter(burstEvents, t)
  }

  function rewindBursts(t: number): void {
    burstPtr = firstIndexAfter(burstEvents, t)
  }

  return {
    rebuildSources,
    resyncBursts,
    rewind,
    rewindBursts,
    advanceTo,
    updateNow,
    clear,
    ghostOf: (eid) => ghostByEid.get(eid),
    hasFlash: (eid) => flashByEid.has(eid),
    hasActive: () => ghostByEid.size > 0 || flashByEid.size > 0,
  }
}