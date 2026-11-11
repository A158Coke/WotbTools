// summarize.mjs <tagPrefix> ... → 每 (场景,节流) 输出各次 run 的 >100/>200 帧数、重建次数、terrain-build 耗时、swapMs，并给出极差
import { readdirSync, readFileSync } from 'node:fs'
const pfx = process.argv[2]
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null }
const groups = {}
for (const f of readdirSync('out').filter(f => f.startsWith(pfx) && f.endsWith('.json') && !f.includes('_prof'))) {
  const j = JSON.parse(readFileSync('out/' + f))
  const key = `${j.scenario} x${j.rate}`
  const ev = (j.captureEvents || []).filter(e => e.stage === 'terrain-build')
  const swap = ev.map(e => e.swapMs).filter(Number.isFinite)
  const modes = [...new Set(ev.map(e => e.mode ?? 'sync'))].join('/')
  ;(groups[key] ||= []).push({ f, n: j.stat.n, p50: j.stat.p50, p99: j.stat.p99, max: j.stat.max, gt100: j.stat.gt100, gt200: j.stat.gt200, gt400: j.stat.gt400, builds: ev.length, buildMs_p50: pct(ev.map(e => e.adaptiveMs + e.assemblyMs + e.normalsMs + e.boundsMs), .5), swap_p95: swap.length ? pct(swap, .95) : null, modes, geoms: j.resources?.geometries })
}
const out = []
for (const [k, rs] of Object.entries(groups).sort()) {
  out.push(`### ${k}（${rs.length} 次）`)
  out.push('| run | 帧 | p50 | p99 | max | >100 | >200 | >400 | terrain-build | 单次构建 p50 ms | swapMs p95 | mode | geometries |')
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rs) out.push(`| ${r.f.replace('.json', '')} | ${r.n} | ${r.p50?.toFixed(1)} | ${r.p99?.toFixed(0)} | ${r.max?.toFixed(0)} | ${r.gt100} | ${r.gt200} | ${r.gt400} | ${r.builds} | ${r.buildMs_p50?.toFixed(0)} | ${r.swap_p95 ?? '-'} | ${r.modes} | ${r.geoms} |`)
  const rng = (f) => { const v = rs.map(r => r[f]); return `${Math.min(...v)}–${Math.max(...v)}` }
  out.push(`极差：>100=${rng('gt100')}，>200=${rng('gt200')}，terrain-build=${rng('builds')}\n`)
}
console.log(out.join('\n'))
