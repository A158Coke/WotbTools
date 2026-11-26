interface ModelBbox {
  min: number[]
  max: number[]
}

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

export function tankDimensions(modules: any, turret: any, track: any): TankDimensions | null {
  const hullPosition = track?.stats?.hullPosition
  const turretOrigin = modules?.turretOrigin
  if (!Array.isArray(hullPosition) || hullPosition.length < 3) return null
  const hullOffset = [hullPosition[0], hullPosition[2], hullPosition[1]]
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
  if (boxes.length < 2) return null
  const min = [0, 1, 2].map(i => Math.min(...boxes.map(box => box.min[i])))
  const max = [0, 1, 2].map(i => Math.max(...boxes.map(box => box.max[i])))
  const size = [0, 1, 2].map(i => max[i] - min[i])
  if (!size.every(value => Number.isFinite(value) && value > 0.5 && value < 20)) return null
  return { width: size[0], length: size[1], height: size[2], volume: size[0] * size[1] * size[2] }
}
