import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
const files = readdirSync('out').filter(f => f.endsWith('.json') && !f.includes('_prof') && f.startsWith('random_')).sort()
const f1 = (x) => x == null ? '-' : (+x).toFixed(1)
let md = '| 运行 | 节流 | rAF n | p50 | p95 | p99 | max | >33ms | >50 | >100 | >200 | >400 | longtask 数/总ms/最大 | cap cpu p50/p95/max | 地形重建/检查 | dpr | armor 帧 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n'
for (const f of files) {
  const r = JSON.parse(readFileSync('out/' + f))
  const pct=(a,p)=>{const x=[...a].sort((m,n)=>m-n);return x[Math.min(x.length-1,Math.floor(p*(x.length-1)+.5))]}
  const cut = r.raf.ts[0] + r.secs*1000 - 100
  const ts = r.raf.ts.filter(t=>t<=cut); const iv = ts.slice(1).map((t,i)=>t-ts[i])
  const lts = r.raf.lt.filter(x=>x[0]<=cut)
  const s = { n:iv.length, p50:pct(iv,.5), p95:pct(iv,.95), p99:pct(iv,.99), max:Math.max(...iv), gt33:iv.filter(x=>x>33.4).length, gt50:iv.filter(x=>x>50).length, gt100:iv.filter(x=>x>100).length, gt200:iv.filter(x=>x>200).length, gt400:iv.filter(x=>x>400).length, longtasks:lts.length, longtaskTotalMs:lts.reduce((a,b)=>a+b[1],0), longtaskMax:Math.max(0,...lts.map(x=>x[1])) }
  const c = r.frameStat
  md += `| ${r.scenario}${r.fixture.startsWith('random') ? '' : '/' + r.fixture} | ${r.rate}x | ${s.n} | ${f1(s.p50)} | ${f1(s.p95)} | ${f1(s.p99)} | ${f1(s.max)} | ${s.gt33} | ${s.gt50} | ${s.gt100} | ${s.gt200} | ${s.gt400} | ${s.longtasks}/${f1(s.longtaskTotalMs)}/${f1(s.longtaskMax)} | ${f1(c.cpu_p50)}/${f1(c.cpu_p95)}/${f1(c.cpu_max)} | ${c.rebuilds}/${c.checks} | ${c.dprMin}-${c.dprMax} | ${c.armorCallFrames} |\n`
}
writeFileSync('summary-table.md', md)
// 长帧（interval>=100ms）阶段构成
let lf = ''
for (const f of files) {
  const r = JSON.parse(readFileSync('out/' + f))
  const big = r.frames.filter(x => x.frameIntervalMs >= 100)
  if (!big.length) continue
  lf += `\n### ${r.name}（${big.length} 个 ≥100ms 帧；capture 内共 ${r.frames.length}）\n| t(回放s) | 帧间隔 | cpuFrame | tick | camera | update | terrainChk | render | armor | 重建累计 |\n|---|---|---|---|---|---|---|---|---|---|\n`
  for (const x of big.slice(0, 12)) lf += `| ${f1(x.t)} | ${f1(x.frameIntervalMs)} | ${f1(x.cpuFrameMs)} | ${f1(x.tickMs)} | ${f1(x.cameraMs)} | ${f1(x.updateMs)} | ${f1(x.terrainCheckInclusiveMs)} | ${f1(x.renderMs)} | ${f1(x.armorMs)} | ${x.terrainRebuilds} |\n`
}
writeFileSync('longframes.md', lf)
console.log(md)
