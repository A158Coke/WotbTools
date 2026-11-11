import { readFileSync, readdirSync } from 'node:fs'
const rows = []
for (const f of readdirSync('out').filter(f => f.includes('_prof'))) {
  const r = JSON.parse(readFileSync('out/' + f)); const p = r.profile
  const byId = new Map(p.nodes.map(n => [n.id, n]))
  const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id)
  const label = (n) => { const c = n.callFrame; const u = (c.url || '').replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '').replace(/^.*node_modules\//, 'nm/'); return `${c.functionName || '(anon)'} ${u}:${c.lineNumber + 1}` }
  // sample times (ms, page clock)
  let t = p.startTime; const times = p.samples.map((_, i) => { t += p.timeDeltas[i]; return (t - p.startTime) / 1000 + r.profile.p0 })
  const tot = {}, self = {}
  const win = (a, b) => { const o = {}; let n = 0; p.samples.forEach((id, i) => { if (times[i] >= a && times[i] < b) { const l = label(byId.get(id)); o[l] = (o[l] || 0) + (p.timeDeltas[i + 1] ?? 500) / 1000; n++ } }); return o }
  const sum = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
  const whole = win(-1, 1e12)
  const total = Object.values(whole).reduce((a, b) => a + b, 0)
  const idle = (whole['(idle) :1'] || 0), prog = (whole['(program) :0'] || 0) + (whole['(program) :1'] || 0), gc = (whole['(garbage collector) :1'] || 0)
  console.log(`\n## ${r.name}  总采样 ${total.toFixed(0)}ms idle ${(idle / total * 100).toFixed(0)}% program ${(prog / total * 100).toFixed(0)}% gc ${(gc / total * 100).toFixed(1)}%`)
  console.log('TOP self (全程):'); for (const [l, v] of sum(whole).slice(0, 18)) console.log(`  ${(v / total * 100).toFixed(1)}%  ${v.toFixed(0)}ms  ${l}`)
  // 长 rAF 间隔窗口（>=60ms）
  const ts = r.raf.ts; const long = []; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] >= 60) long.push([ts[i - 1], ts[i]])
  const agg = {}; let lw = 0; for (const [a, b] of long) { lw += b - a; for (const [l, v] of Object.entries(win(a, b))) agg[l] = (agg[l] || 0) + v }
  console.log(`长帧窗口(>=60ms) ${long.length} 个, 合计 ${lw.toFixed(0)}ms; TOP self:`); for (const [l, v] of sum(agg).slice(0, 14)) console.log(`  ${v.toFixed(0)}ms  ${l}`)
  const lt = r.raf.lt; console.log('longtasks', lt.length, 'top', lt.map(x => x[1]).sort((a, b) => b - a).slice(0, 5).map(x => x.toFixed(0)))
}
