import { readFileSync } from 'node:fs'
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(`out/${f}.json`))
  const ts = j.raf.ts, t0 = ts[0], tEnd = ts[ts.length - 1]
  const iv = ts.slice(1).map((t, i) => [t - t0, t - ts[i]])
  const longs = iv.filter(x => x[1] > 100)
  console.log(f, 'dur', ((tEnd - t0) / 1000).toFixed(1), 's; >100:', longs.length)
  console.log('  first/last long at s:', longs.slice(0, 3).map(x => (x[0] / 1000).toFixed(1) + '/' + x[1].toFixed(0)).join(' '), '...', longs.slice(-3).map(x => (x[0] / 1000).toFixed(1) + '/' + x[1].toFixed(0)).join(' '))
  const fr = j.frames
  const ev = (j.captureEvents || []).filter(e => e.stage === 'terrain-build')
  const bigcpu = fr.filter(f => f.cpuFrameMs > 100)
  console.log('  frames cpu>100:', bigcpu.length, 'of', fr.length, '; with rebuild?', 'renderMs>50:', fr.filter(f => f.renderMs > 50).length, 'tickMs>50:', fr.filter(f => f.tickMs > 50).length, 'checkIncl>50:', fr.filter(f => f.terrainCheckInclusiveMs > 50).length)
  const m = (a) => a.length ? Math.max(...a).toFixed(1) : '-'
  console.log('  swapMs max', m(ev.map(e => e.swapMs).filter(Number.isFinite)), 'queueMs p50', ev.map(e=>e.queueMs).filter(Number.isFinite).sort((a,b)=>a-b)[Math.floor(ev.length/2)]?.toFixed(0), 'cpu max', m(fr.map(f => f.cpuFrameMs)))
}
