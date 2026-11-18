/**
 * 最后已知位姿（「可视性诚实呈现」，借鉴 blitzinfo）。
 *
 * 回放文件只包含**录制客户端所见**的实体：Type33→Type5 物化 = 进入观察集、Type4 = 离开
 * （硬黑屏）。离场之后回放里没有任何位置证据——呈现层不得重建（不插值、不外推、不猜），
 * 只能停在「最后已知位置」：该坦克**最后一个在场段**（语义判别器只允许是协议 AoI 在场段，
 * 禁止对位置序列做任何统计推断）内最后一个 0.1s 网格采样的位姿。
 *
 * 语义（与 `trackInterp.spansContainAt` / `visibilitySpanForSampling` 的现有判据同容差）：
 *   - `t` 落在某个在场段 [t_in, t_out] 内（闭区间）→ null：正常呈现，无幽灵；
 *   - `t` 落在段间空隙或战斗尾声（晚于末段）→ 最近一个已开始的段的**段内末采样**位姿 + 该时刻；
 *   - `t` 早于首段（从未被观测）→ null：没有「最后已知」可言；
 *   - 段列表为空/畸形、位姿列缺失/长度非 3 倍数、段末早于网格起点（该段无采样证据）→
 *     null（fail-closed，绝不拿段外的采样顶替）。
 *
 * 纯函数、无 THREE/DOM 依赖（单测锁不变量）。返回的 pos 是 game 系网格原值——消费方
 * 施加各自的视图帧变换（3D 场景 x 取负，见 replay-local/pose/vehiclePose.ts 头注释）。
 */
import { GRID_DT } from '../trackInterp.js'

/** 某坦克在「不在场」时刻的最后已知呈现（末段末采样）。 */
export interface LastKnownPose {
  /** 最后已知采样时刻（回放时钟域；= 该段内最后一个 0.1s 网格采样） */
  t: number
  /** 该时刻的网格采样位置 [x, y, z]（game 系原值，未做视图镜像） */
  pos: [number, number, number]
}

/** 段集合与闭区间判定的浮点容差（与 trackInterp 的 spansContainAt 一致）。 */
const SPAN_EPS = 1e-6

/**
 * 求某坦克在回放时刻 `t` 的最后已知位姿。
 *
 * @param spans 协议 AoI 在场段 flat `[t_in, t_out, ...]`（升序；末段缺 t_out = 战斗结束 →
 *              +∞，与 `visibilitySpansByEid` 的投影一致；coverage 同形状可用）
 * @param t     当前回放时刻（回放时钟域）
 * @param pos   该坦克 0.1s 采样位姿扁平数组 `[x,y,z] × samples`（AgentVehicleTrack.pos；
 *              采样 i 的时刻 = `tStart + i * GRID_DT`）
 * @param tStart 位姿网格起点（`meta.t_start`，回放时钟域）
 * @returns 在场 → null；不在场且有证据 → `{ t, pos }`；无证据/输入畸形 → null
 */
export function lastKnownPoseAt(
  spans: readonly number[] | null | undefined,
  t: number,
  pos: readonly number[] | null | undefined,
  tStart: number,
): LastKnownPose | null {
  if (!Array.isArray(spans) || !Number.isFinite(t) || !Number.isFinite(tStart)) return null
  if (!Array.isArray(pos) || pos.length < 3 || pos.length % 3 !== 0) return null
  const n = pos.length / 3
  // 最近一个「已开始」的段：段间空隙取前段、战斗尾声取末段（同一条判据）；
  // 早于首段时不存在候选 → null。
  let hasCandidate = false
  let candStart = 0
  let candEnd = 0
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const start = spans[i]
    const end = spans[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - SPAN_EPS && t <= end + SPAN_EPS) return null   // 在场：正常呈现
    if (start <= t + SPAN_EPS) {
      hasCandidate = true
      candStart = start
      candEnd = end
    }
  }
  if (!hasCandidate) return null
  // 段内最后一个网格采样（闭区间）：+∞ 末段（缺 t_out = 战斗结束）取网格末采样；
  // 段末晚于网格末采样 → 同样钳到末采样（它仍在段内）。段末早于网格起点 → 该段无
  // 采样证据，fail-closed 返回 null，绝不拿段外采样顶替。
  const rawIdx = Number.isFinite(candEnd)
    ? Math.floor((candEnd - tStart) / GRID_DT + 1e-9)
    : n - 1
  const idx = Math.min(n - 1, rawIdx)
  if (idx < 0) return null
  const sampleT = tStart + idx * GRID_DT
  // 采样必须仍落在候选段内：段短于网格间隔且不覆盖任何网格点时（如 tStart=5、
  // 段 [12.34,12.34]），向下取整会取到段起点之前的采样——那是该次在场**从未观测**
  // 的位置，fail-closed 返回 null（幽灵与名牌都不显示，绝不外推）。
  if (sampleT < candStart - SPAN_EPS) return null
  return { t: sampleT, pos: [pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]] }
}

/**
 * 该 eid 在**当前回放时刻 t** 是否已被同账号的后继实体替换（AoI 重入/复活换 eid）。
 *
 * 判别器 = 账号身份 + 协议 AoI 在场段（格式语义，非内容统计）：同账号另一 eid 的首个
 * 在场段起点晚于本 eid 末段终点 → 该后继实体是接管者；**只有回放时刻到达其接管时刻
 * 之后**才抑制（倒带回到接管前必须恢复旧实体的最后已知记录）。接管前不提前隐藏。
 * 重叠/同段的多实体不判替换（本函数是缺省回退；权威身份证据在宿主 canonical
 * `entityStartsByAccount` + `activeEntityAt`，覆盖重叠段场景）。
 */
export function replacedBySuccessorAt(
  vehicles: ReadonlyArray<{ eid: number; account_id?: number | null }> | null | undefined,
  spansOf: (eid: number) => readonly number[] | null | undefined,
  eid: number,
  t: unknown,
): boolean {
  const now = Number(t)
  if (!Array.isArray(vehicles) || !Number.isFinite(now)) return false
  const self = vehicles.find((v) => v?.eid === eid)
  if (!self || self.account_id == null) return false
  const selfEnd = lastSpanEnd(spansOf(eid))
  if (selfEnd == null) return false
  for (const other of vehicles) {
    if (!other || other.eid === eid || other.account_id !== self.account_id) continue
    const otherStart = firstSpanStart(spansOf(other.eid))
    if (otherStart == null || otherStart <= selfEnd + SPAN_EPS) continue
    if (now >= otherStart - SPAN_EPS) return true // 已到接管时刻：旧实体幽灵抑制
  }
  return false
}

function firstSpanStart(spans: readonly number[] | null | undefined): number | null {
  if (!Array.isArray(spans) || spans.length < 2) return null
  for (let i = 0; i + 1 < spans.length; i += 2) {
    if (Number.isFinite(spans[i])) return spans[i]
  }
  return null
}

function lastSpanEnd(spans: readonly number[] | null | undefined): number | null {
  if (!Array.isArray(spans) || spans.length < 2) return null
  let end: number | null = null
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const e = spans[i + 1]
    if (Number.isFinite(e)) end = e
    else if (e === Number.POSITIVE_INFINITY) end = e
  }
  return end
}
