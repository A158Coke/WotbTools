/**
 * 客户端 maskSlice（炮管外部模块的切片平面）原值语义（2026-10-28）。
 *
 * 数据面：`data/gunMaskSlices.json`（上游 `tools/emit_vehicle_pb.py` 从客户端逐车 yaml
 * `maskSlice.<gun_NN>` 原样导出），键 = `<tank_id>:<turret_local>:<gun_local>`——maskSlice
 * 是**逐车逐炮位**的数据，同一门炮装到不同炮塔上节点号/平面位置都不同（T-34 的
 * gun_01 0.8415 与 gun_07 0.8743 共用主炮模块），不能按 module id 归并。
 *
 * 平面定义在 **gun_NN 节点局部系**：`position` / `normal` 经该节点的 world 矩阵变换
 * （normal 走 normal matrix）。`planeSliceMode !== 1` = 客户端不做平面切割（467/469 门炮
 * 为 1，两条低阶炮为 0）——不建平面，不做“有 mask 就裁”的近似。
 *
 * `axis` / `frustumCone*` 一并透传：当前数据里 `frustumConeSliceMode` 全为 0（锥台切片
 * 未启用），平面切割只用 position/normal；锥台切片尚未建模。
 */
import { Matrix3, Vector3 } from 'three'

/** sidecar 键（与上游 emitter 同式）。turret_local/gun_local = module_id >> 8。 */
export function gunMaskSliceKey(tankId, cfg) {
  if (tankId == null || !cfg) return null
  const tl = cfg.turret_local
  const gl = cfg.gun_local
  if (tl == null || gl == null) return null
  return `${tankId}:${tl}:${gl}`
}

/** 记录对应的可视节点名（maskSlice 键 gun_NN 的 NN）。 */
export function gunMaskNodeName(record) {
  const n = Number(record?.node)
  if (!Number.isInteger(n) || n < 0 || n > 99) return null
  return `gun_${String(n).padStart(2, '0')}`
}

const _nm = new Matrix3()

/**
 * 客户端记录 → 世界系平面参数（写入调用方的 out 向量，避免每帧分配）。
 * @param {object} record sidecar 记录
 * @param {import('three').Matrix4} matrixWorld gun_NN 节点的世界矩阵
 * @param {Vector3} outNormal 输出：世界系单位法线（朝炮口）
 * @param {Vector3} outPoint 输出：世界系平面上一点
 * @returns {boolean} false = 客户端未启用平面切割 / 记录不完整（调用方不建裁切面）
 */
export function gunMaskPlaneWorld(record, matrixWorld, outNormal, outPoint) {
  if (!record || !matrixWorld) return false
  if (Number(record.plane_slice_mode) !== 1) return false
  const pos = record.position
  const nrm = record.normal
  if (!Array.isArray(pos) || pos.length < 3 || !Array.isArray(nrm) || nrm.length < 3) return false
  if (!pos.slice(0, 3).concat(nrm.slice(0, 3)).every(Number.isFinite)) return false
  outPoint.set(pos[0], pos[1], pos[2]).applyMatrix4(matrixWorld)
  outNormal.set(nrm[0], nrm[1], nrm[2]).applyMatrix3(_nm.getNormalMatrix(matrixWorld))
  if (outNormal.lengthSq() < 1e-12) return false
  outNormal.normalize()
  return true
}
