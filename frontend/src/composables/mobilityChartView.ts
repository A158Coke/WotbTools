import { speedAt, type Terrain, type Run } from '../replay-local/compute/mobility'

export interface MobilityChartView {
  terrain: Terrain | 'all'
  hidden: string[]
  isolated: string
  cursor: number
  windowEnd: number
  zoom: [number, number] | null
  search: string
  pairA: string
  pairB: string
}
export function defaultChartView(single = false): MobilityChartView {
  return { terrain: single ? 'all' : 'Firm', hidden: [], isolated: '', cursor: 0, windowEnd: 90,
    zoom: null, search: '', pairA: '', pairB: '' }
}
export function copyChartView(view: MobilityChartView): MobilityChartView {
  return { ...view, hidden: [...view.hidden], zoom: view.zoom ? [...view.zoom] : null }
}
export function rankCurveReadings<T extends { run: Run }>(lines: T[], cursor: number) {
  return lines.map((line, order) => {
    const speed = speedAt(line.run.speeds, cursor)
    return { line, order, speed: speed !== null && Number.isFinite(speed) ? speed : null }
  }).sort((a, b) => {
    if (a.speed === b.speed) return a.order - b.order
    if (a.speed === null) return 1
    if (b.speed === null) return -1
    return b.speed - a.speed
  })
}
