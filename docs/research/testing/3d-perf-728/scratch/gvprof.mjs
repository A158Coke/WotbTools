// 解析 Gecko Profiler 导出（processed profile JSON）：按线程汇总自耗时 / 类别
import { readFileSync, readdirSync } from 'node:fs'
for (const f of readdirSync('out').filter(f => f.endsWith('.profile.json'))) {
  const p = JSON.parse(readFileSync('out/' + f))
  const ver = p.meta?.version
  console.log(`\n## ${f}  profile v${ver}  interval ${p.meta?.interval}  processes ${p.processes?.length ?? '-'}  threads ${p.threads?.length ?? '-'}`)
  const all = [...(p.threads || []), ...((p.processes || []).flatMap(x => x.threads || []))]
  const str = (t, i) => (t.stringArray || p.shared?.stringArray || [])[i]
  for (const t of all) {
    const s = t.samples; if (!s) continue
    const n = (s.stack || s.data || []).length
    console.log('thread', t.name, t.processName || '', t.processType || '', 'samples', n)
  }
}
