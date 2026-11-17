import { expect, it } from 'vitest'
import { rankCurveReadings, copyChartView, defaultChartView } from './mobilityChartView'
import type { Run } from '../replay-local/compute/mobility'

function line(id: string, speeds: number[]) {
  const run: Run = { speeds, status: 'window', upper: null, reached: null, near: null }
  return { id, run }
}
it('ranks all visible curves before taking four, using raw numbers and stable ties', () => {
  const lines = [43.15,47.47,40.66,47.65,60,47.47001,47.47].map((v,i)=>line(String(i),[0,v]))
  const ranked = rankCurveReadings(lines,0.02)
  expect(ranked.slice(0,4).map(r=>r.line.id)).toEqual(['4','3','5','1'])
  expect(ranked.map(r=>r.line.id)).toEqual(['4','3','5','1','6','0','2'])
  expect(rankCurveReadings(lines,0).map(r=>r.line.id)).toEqual(lines.map(r=>r.id))
})
it('updates after crossings and preserves missing speeds as unavailable', () => {
  const a = line('a',[0,20,30]), b = line('b',[0,18,35]), bad = line('bad',[0,NaN])
  expect(rankCurveReadings([a,b,bad],0.02).map(r=>r.line.id)).toEqual(['a','b','bad'])
  expect(rankCurveReadings([a,b,bad],0.04).map(r=>r.line.id)).toEqual(['b','a','bad'])
  expect(rankCurveReadings([a,b,bad],1).map(r=>r.speed)).toEqual([null,null,null])
  expect(rankCurveReadings([a,b],0.03)[0].speed).toBe(26.5)
})
it('copies mutable view fields so an undo snapshot cannot be edited through live state', () => {
  const view=defaultChartView()
  view.hidden=['aFirm'];view.zoom=[1,20]
  const saved=copyChartView(view)
  view.hidden.push('bSoft');view.zoom[0]=3
  expect(saved.hidden).toEqual(['aFirm'])
  expect(saved.zoom).toEqual([1,20])
})
