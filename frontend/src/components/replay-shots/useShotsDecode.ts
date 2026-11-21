/**
 * ReplayShotsPane —— 解码管线（拆分自 ReplayShotsPane.vue，行为原样）。
 * 在途解析认领（parseSeq）、弹种/名册/搭载富化、官方示例之外的文件解码。
 */
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
  /** 在途解析的认领序号：文件切换后迟到的结果一律丢弃 */
  let parseSeq = 0
  let parsedFile: File | null = null
  let decoding = Promise.resolve()

  /**
   * 弹种表与搭载输入都来自资产包（/data/shellKinds.json 与 tank/{id}.json，静态资产源分发，
   * 与上游 tanks.pb 同批刷新）：弹种表只在首次解析时按需加载一次，搭载输入逐车取。
   * 资产源未配置 / 请求失败时按降级语义继续（弹种走槽位/id 兜底、俯仰如实降级标记）。
   */
  let shellTablePromise: Promise<AgentShellTable> | null = null
  function loadShellTable() {
    if (!shellTablePromise) {
      shellTablePromise = assetProvider.json('/data/shellKinds.json')
      shellTablePromise.catch(() => { shellTablePromise = null })
    }
    return shellTablePromise
  }

  /**
   * 弹种富化兜底（旧产物路径：WASM 输出没有 shell 字段时在客户端按同款表反解；
   * 新产物由 WASM 注入，此处零命中直通）。
   */
  function enrichShellFallback(parsedShots: AgentShotReplay[], table: AgentShellTable) {
    for (const shot of parsedShots) {
      if (!shot.shell_id || shot.shell) continue
      const entry = table?.[String(shot.shell_id)]
      if (!entry) continue
      shot.shell = entry
      shot.shell_kind = shot.shell_kind || entry.type
    }
  }

  /** 名册联表只补身份与阵营（`enrichShotsFromRoster`）；昵称缺在射击链上是常态
   *  （他人宽松路径不带昵称），这里按 eid 联表补齐昵称——姓名不可解析时界面显示
   *  「未知玩家」，绝不落回内部 id（design-language §11）。
   */
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
      // 时序：先解析 playback（轻）构建俯仰锚定表，射击链只做一次重解析。
      // 锚定注入失败（产物过旧等）→ 裸解析兜底（俯仰降级标记如实透传）。
      let playback = null
      let pitchLimits = null
      try {
        playback = await parseAgentPlaybackFromBytes(bytes)
        if (seq !== parseSeq) return
        // 与 3D 场景同一推导（playbackScene.js：resolveReplayClock(DATA.periods, null, meta.duration)）
        battleStartRaw.value = resolveReplayClock(playback.periods || [], null, playback.meta?.duration)?.startRaw ?? 0
        pitchLimits = await buildPitchLimits(playback.vehicles)
      } catch (e) {
        console.warn('pitch limits skipped:', e)
      }
      if (seq !== parseSeq) return
      // 弹种表（COS /data/shellKinds.json）与解析**并行**取用，不在发布前 await——
      // 已完成的本地解析不被资产平台的响应速度卡住（与下方 annotateMountedConfigs
      // 同款异步增强契约）。表到位后按同款表原地补齐 shell/shell_kind（WASM 端未注入
      // 时客户端补齐同构）；资产源未配置/失败 → undefined，弹种保持槽位/id 兜底。
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
      // 作者严格路径 fail-visible（契约 v0.1.9）：失败不再静默，警示条 + 他人宽松全量
      authorError.value = outcome.author_error || ''
      // 他人宽松路径 fail-visible（上游 v0.4.20）：others_error 在场 = 他人链内部不变量破坏
      othersError.value = outcome.others_error || ''
      const parsedShots = outcome.shots
      // 富化失败不阻断主表（名册失败仅 3D 链接缺失；弹种反解失败走槽位/id 兜底）
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
      // 先发布本地解析结果（P1 评审）：搭载配置注解是**可选增强**，其资产请求无超时
      // 语义——await 它会让已完成的本地解析被远端资产的响应速度卡住。异步补做：
      // 闭包持有本文件的 parsedShots，就地注入；文件切换后旧数组不再被 shots.value
      // 引用，迟到注入无副作用（shooter_config_idx 消费点也有未注解回退链）。
      shots.value = parsedShots
      // 弹表迟到补齐（评审 P2）：回调注册于**发布之后**，经响应式视图写入以触发重绘
      // （直接改原始数组 parsedShots 会绕过 Vue 代理，迟到补齐不重绘）；表已就绪时
      // 回调也在微任务中晚于上面的赋值执行——shots.value 必为本文件的列表，
      // 文件切换由 seq 隔离。
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

  /** 解码时机 watcher 的文件切换分支：作废在飞并清空本模块投影。 */
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

  /** 解码时机 = 能力激活（首次进入射击分析）或激活期间换了目标回放；同一文件不重复解码。 */
  function beginDecode(active: boolean, file: File | null, blocked: boolean) {
    invalidateForFile(file)
    if (!active || !file || blocked) return
    if (parsedFile === file) return
    parsedFile = file
    decoding = decode(file)
  }

  function dispose() {
    // 工作台退出登录会卸载面板；不得继续启动后续解析或资产富化。
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
