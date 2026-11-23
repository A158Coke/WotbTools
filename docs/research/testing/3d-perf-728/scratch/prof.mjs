import { existsSync, readFileSync, readdirSync } from 'node:fs'

// CDP samples use a monotonic clock. run.mjs stores the profile start on the page clock.
function summarizeWindows(profile, windows) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]))
  const parents = new Map()
  for (const node of profile.nodes) {
    for (const child of node.children || []) parents.set(child, node.id)
  }
  const self = new Map()
  const inclusive = new Map()
  let windowIndex = 0
  let start = profile.p0
  for (const [i, id] of profile.samples.entries()) {
    start += profile.timeDeltas[i] / 1000
    const end = start + (profile.timeDeltas[i + 1] || 0) / 1000
    while (windowIndex < windows.length && windows[windowIndex][1] <= start) windowIndex++
    let duration = 0
    for (let k = windowIndex; k < windows.length && windows[k][0] < end; k++) {
      duration += Math.max(0, Math.min(end, windows[k][1]) - Math.max(start, windows[k][0]))
    }
    if (!duration) continue
    const unique = new Set()
    for (let current = id; current !== undefined; current = parents.get(current)) {
      const frame = nodes.get(current).callFrame
      const path = frame.url.split('?')[0].replace(/^https?:\/\/[^/]+/, '')
      const label = (frame.functionName || '(anonymous)') + ' ' + path + ':' + (frame.lineNumber + 1)
      if (current === id) self.set(label, (self.get(label) || 0) + duration)
      unique.add(label)
    }
    for (const label of unique) inclusive.set(label, (inclusive.get(label) || 0) + duration)
  }
  return { self, inclusive }
}

// captureName() suffixes diagnostic captures with _profile / _profile-trace
// (hook flags sorted alphabetically, so --profile --count-anchors comes first).
// Keep the pre-captureName _prof / _prof_noprobe names readable.
const PROFILE_SUFFIX = /_(?:prof(?:_noprobe)?|(?:count-anchors-)?profile(?:-trace)?)\.json$/
const files = process.argv.slice(2)
if (!files.length) {
  const discovered = readdirSync('out').filter(file => PROFILE_SUFFIX.test(file))
  if (!discovered.length) throw new Error('No profile captures found in out/ (expected *_profile.json, *_profile-trace.json, *_prof.json or *_prof_noprobe.json)')
  files.push(...discovered)
}
for (const file of files) {
  const { name, profile, raf } = JSON.parse(readFileSync('out/' + file))
  if (!profile || raf.ts.length < 2) continue
  const intervals = raf.ts.slice(1).map((t, i) => t - raf.ts[i]).sort((a, b) => a - b)
  const tail = intervals[Math.ceil(.99 * intervals.length) - 1]
  const path = 'out/traces/' + file
  if (existsSync(path) && raf.nativeCalls) {
    const { traceEvents } = JSON.parse(readFileSync(path, 'utf8'))
    const marker = traceEvents.find(e => e.name === 'pb-benchmark-start')
    if (!marker) throw new Error('Missing trace clock marker in ' + path)
    const offset = marker.ts / 1000 - raf.start
    const selected = new Set(['Layout', 'UpdateLayoutTree', 'PrePaint', 'Paint', 'MajorGC'])
    const costs = new Map()
    function add(key, ms) {
      const total = costs.get(key) || { count: 0, ms: 0 }
      total.count++
      total.ms += ms
      costs.set(key, total)
    }
    for (const e of traceEvents) {
      const t = e.ts / 1000 - offset
      if (e.pid === marker.pid && e.tid === marker.tid && e.ph === 'X' && selected.has(e.name)
          && t >= raf.ts[0] && t < raf.ts.at(-1)) add(e.name, e.dur / 1000)
    }
    for (const e of raf.nativeCalls) {
      if (e.start >= raf.ts[0] && e.start < raf.ts.at(-1)) add(e.key + ' ' + (e.element || ''), e.ms)
    }
    for (const [key, cost] of costs) console.log(name, key, cost.count, cost.ms.toFixed(1) + ' ms')
  }
  for (const threshold of new Set([0, tail - 1e-6, 60, 100])) {
    const windows = []
    for (let i = 1; i < raf.ts.length; i++) {
      if (raf.ts[i] - raf.ts[i - 1] > threshold) windows.push([raf.ts[i - 1], raf.ts[i]])
    }
    const { self, inclusive } = summarizeWindows(profile, windows)
    console.log(name, 'rAF >', threshold, 'ms:', windows.length, 'intervals')
    for (const [title, times] of [['self', self], ['inclusive', inclusive]]) {
      const top = [...times.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      for (const [label, ms] of top) console.log(title, ms.toFixed(1), 'ms', label)
    }
  }
}
