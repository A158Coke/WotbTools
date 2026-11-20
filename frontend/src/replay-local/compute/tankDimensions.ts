interface ModelBbox {
  min: number[]
  max: number[]
}

/** 单个碰撞盒 + 挂点偏移；全零 = 客户端空心占位（无炮塔 TD），返回 null 不参与并集。 */
function bboxWithOffset(box: any, offset?: number[] | null): ModelBbox | null {
  if (!box || !Array.isArray(box.min) || !Array.isArray(box.max)) return null
  if (box.min.length < 3 || box.max.length < 3) return null
  const values = [...box.min.slice(0, 3), ...box.max.slice(0, 3)]
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return null
  if (values.every(value => value === 0)) return null
  const shift = offset || [0, 0, 0]
  return {
    min: box.min.slice(0, 3).map((value: number, i: number) => value + (shift[i] || 0)),
    max: box.max.slice(0, 3).map((value: number, i: number) => value + (shift[i] || 0)),
  }
}

export interface TankDimensions {
  width: number
  length: number
  height: number
  volume: number
}

/**
 * 车体尺寸（BI 11.21 Dimensions 同口径）：底盘 + 车体 + 当前炮塔碰撞盒并集，**不含炮管**
 * （BI 文案：“车体、炮塔和行走部分的长度/宽度/高度，无炮管——按游戏碰撞”）。
 *
 * 碰撞盒坐标是 [x 宽, y 长, z 高]；车辆 XML 的挂点（`hullPosition` / `turretPositions`）
 * 是 [x, 上, 前]，叠加前换序为 [x, 前, 上]；炮塔挂点 = 车体挂点 + 炮塔相对挂点。
 * 对拍：T-34 顶级炮塔 5.72 × 2.94 × 2.63 m、116-F3 7.63 × 3.49 × 2.70 m，与 BI 逐值一致。
 * 任一必需盒缺失/非数值 → null（fail-closed；参数行隐藏，不猜尺寸）。
 */
export function tankDimensions(modules: any, turret: any, track: any): TankDimensions | null {
  const hullPosition = track?.stats?.hullPosition
  const turretOrigin = modules?.turretOrigin
  if (!Array.isArray(hullPosition) || hullPosition.length < 3) return null
  // [x, 上, 前] → [x, 前, 上]
  const hullOffset = [hullPosition[0], hullPosition[2], hullPosition[1]]
  // 炮塔盒是空心占位（无炮塔 TD）时不参与并集，也不要求挂点存在；
  // 有实体炮塔盒却没有挂点 = 无法定位，整组 fail-closed。
  const turretBox = bboxWithOffset(turret?.stats?.bbox)
  if (turretBox && (!Array.isArray(turretOrigin) || turretOrigin.length < 3)) return null
  const turretOffset = turretBox
    ? [
        hullOffset[0] + turretOrigin[0],
        hullOffset[1] + turretOrigin[2],
        hullOffset[2] + turretOrigin[1],
      ]
    : null
  const boxes = [
    bboxWithOffset(modules?.bbox?.chassis),
    bboxWithOffset(modules?.bbox?.hull, hullOffset),
    turretOffset ? bboxWithOffset(turret?.stats?.bbox, turretOffset) : null,
  ].filter((box): box is ModelBbox => box !== null)
  // BI J6：至少两个碰撞盒才出尺寸（缺车体/底盘时整组隐藏）
  if (boxes.length < 2) return null
  const min = [0, 1, 2].map(i => Math.min(...boxes.map(box => box.min[i])))
  const max = [0, 1, 2].map(i => Math.max(...boxes.map(box => box.max[i])))
  const size = [0, 1, 2].map(i => max[i] - min[i])
  // BI J6 的合理区间守卫（0.5–20 m）：坏盒不产出尺寸
  if (!size.every(value => Number.isFinite(value) && value > 0.5 && value < 20)) return null
  return { width: size[0], length: size[1], height: size[2], volume: size[0] * size[1] * size[2] }
}
