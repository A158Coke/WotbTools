import { ref } from 'vue'
import type { AgentShotReplay, AgentShellTable } from '../../api/agent-facets/shotTypes.js'
import type { AgentVehicleTrack } from '../../api/agent-facets/playbackTypes.js'
import type { Tankopedia } from '../../replay-local/compute/tankopedia.js'
import {
  enrichShotsFromRoster,
  parseAgentPlaybackFromBytes,
  parseAgentShotsFromBytes,
} from '../../api/agent-replay-facets.js'
import { annotateMountedConfigs, buildPitchLimits } from '../../scene/shotHandoff.ts'
import { assetProvider } from '../../scene/assetProvider.js'
import { resolveReplayClock } from '../../replay-local/canonical/facts'
import { loadTankopedia } from '../../replay-local/compute/tankopedia.ts'

/** @param {{
 *  t: (key: string) => string,
 *  resetSelection: () => void,
 *  resetScope: () => void,
 * }} ctx */
export function useShotsDecode({ t, resetSelection, resetScope }: { t: (key: string) => string; resetSelection: () => void; resetScope: () => void }) {
  const shots = ref<AgentShotReplay[]>([])
  const parsing = ref(false)
  const err = ref('')
  const authorError = ref('')
  const othersError = ref('')
  const authorEid = ref<number | null>(null)
  const recorderTankName = ref('')
  const battleStartRaw = ref(0)
  let parseSeq = 0
  let parsedFile: File | null = null
  let decoding = Promise.resolve()

  let shellTablePromise: Promise<AgentShellTable> | null = null
  function loadShellTable() {
    if (!shellTablePromise) {
      shellTablePromise = assetProvider.json('/data/shellKinds.json')
      shellTablePromise.catch(() => { shellTablePromise = null })
    }
    return shellTablePromise
  }

  function enrichShellFallback(parsedShots: AgentShotReplay[], table: AgentShellTable) {
    for (const shot of parsedShots) {
      if (!shot.shell_id || shot.shell) continue
      const entry = table?.[String(shot.shell_id)]
      if (!entry) continue
      shot.shell = entry
      shot.shell_kind = shot.shell_kind || entry.type
    }
  }

  function applyRosterNames(parsedShots: AgentShotReplay[], vehicles: AgentVehicleTrack[] | undefined, tankopedia: Tankopedia | null) {
    const byEid = new Map((vehicles || []).map((vehicle) => [vehicle.eid, vehicle]))
    const usableName = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/^#?\d+$/.test(value.trim())
    for (const shot of parsedShots) {
      for (const role of ['shooter', 'target'] as const) {
        const eid = shot[`${role}_eid`]
        const vehicle = eid == null ? undefined : byEid.get(eid)
        if (!shot[`${role}_name`] && vehicle?.nickname) shot[`${role}_name`] = vehicle.nickname
        const info = tankopedia?.info(shot[`${role}_tank_id`] || vehicle?.tank_id || 0)
        const name = [vehicle?.tank_name, info?.name, shot[`${role}_tank_name`]].find(usableName)
        shot[`${role}_tank_name`] = name || ''
        const vehicleMetadata = vehicle as (AgentVehicleTrack & { tank_class?: string; tank_type?: string }) | undefined
        shot[`${role}_tank_class`] = info?.type || vehicleMetadata?.tank_class || vehicleMetadata?.tank_type || ''
      }
    }
  }

  async function decode(file: File) {
    const seq = ++parseSeq
    parsing.value = true
    err.value = ''
    authorError.value = ''
    othersError.value = ''
    resetSelection()
    resetScope()
    authorEid.value = null
    recorderTankName.value = ''
    battleStartRaw.value = 0
    shots.value = []
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (seq !== parseSeq) return
      let playback = null
      let pitchLimits = null
      try {
        playback = await parseAgentPlaybackFromBytes(bytes)
        if (seq !== parseSeq) return
        battleStartRaw.value = resolveReplayClock(playback.periods || [], null, playback.meta?.duration)?.startRaw ?? 0
        pitchLimits = await buildPitchLimits(playback.vehicles)
      } catch (e) {
        console.warn('pitch limits skipped:', e)
      }
      if (seq !== parseSeq) return
      const shellTablePromise = loadShellTable().catch(() => undefined)
      let outcome
      try {
        outcome = await parseAgentShotsFromBytes(bytes, pitchLimits ?? undefined)
      } catch (e) {
        console.warn('anchored parse failed, fallback:', e)
        if (seq !== parseSeq) return
        outcome = await parseAgentShotsFromBytes(bytes)
      }
      if (seq !== parseSeq) return
      authorError.value = outcome.author_error || ''
      othersError.value = outcome.others_error || ''
      const parsedShots = outcome.shots
      if (playback) {
        try {
          enrichShotsFromRoster(parsedShots, playback.vehicles)
        } catch (e) {
          console.warn('roster enrichment skipped:', e)
        }
      }
      if (seq !== parseSeq) return
      const tankopedia = await loadTankopedia().catch(() => null)
      if (seq !== parseSeq) return
      applyRosterNames(parsedShots, playback?.vehicles, tankopedia)
      const playbackAuthor = playback?.meta?.author_eid ?? 0
      authorEid.value = outcome.author_eid > 0 ? outcome.author_eid
        : playbackAuthor > 0 ? playbackAuthor
          : playback?.vehicles?.find((vehicle) => vehicle.is_author)?.eid ?? null
      const recorder = playback?.vehicles?.find((vehicle) => vehicle.eid === authorEid.value || vehicle.is_author)
      recorderTankName.value = recorder?.tank_name || ''
      shots.value = parsedShots
      shellTablePromise.then((shellTable) => {
        if (seq !== parseSeq || !shellTable) return
        const list = shots.value
        if (list && list.some((s) => s.shell_id && !s.shell)) {
          try { enrichShellFallback(list, shellTable) } catch (e) {
            console.warn('shell enrichment skipped:', e)
          }
        }
      })
      if (playback) {
        annotateMountedConfigs(parsedShots, playback?.vehicles).catch((e) => {
          console.warn('mounted-config annotation skipped:', e)
        })
      }
    } catch (e) {
      if (seq !== parseSeq) return
      shots.value = []
      err.value = t('agentShots.error_parse') + ' ' + String(e instanceof Error ? e.message : e).slice(0, 200)
    } finally {
      if (seq === parseSeq) parsing.value = false
    }
  }

  function invalidateForFile(nextFile: File | null) {
    if (parsedFile && parsedFile !== nextFile) {
      parseSeq++
      parsedFile = null
      parsing.value = false
      shots.value = []
      recorderTankName.value = ''
      battleStartRaw.value = 0
      authorEid.value = null
      resetSelection()
      resetScope()
      err.value = ''
      authorError.value = ''
      othersError.value = ''
    }
  }

  function beginDecode(active: boolean, file: File | null, blocked: boolean) {
    invalidateForFile(file)
    if (!active || !file || blocked) return
    if (parsedFile === file) return
    parsedFile = file
    decoding = decode(file)
  }

  function dispose() {
    parseSeq++
  }

  return {
    shots, parsing, err, authorError, othersError, authorEid, recorderTankName, battleStartRaw,
    decode, invalidateForFile, beginDecode, dispose,
    parseSeqNow: () => parseSeq,
    parsedFileNow: () => parsedFile,
    decodingNow: () => decoding,
  }
}
