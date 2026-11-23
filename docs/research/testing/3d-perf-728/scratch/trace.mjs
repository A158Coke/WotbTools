import { open } from 'node:fs/promises'

export function observeAnchorWrites() {
  const root = document.querySelector('[data-testid=vehicle-label-overlay]')
  if (!root) throw new Error('Vehicle label overlay unavailable')
  const counts = { class: 0, style: 0, hidden: 0 }
  window.__pbBenchAnchorWrites = counts
  new MutationObserver(records => {
    const t = performance.now()
    if (!window.__raf || t < window.__raf.start || t >= window.__raf.end) return
    for (const record of records) {
      if (record.target.classList.contains('vehicle-label-anchor')) counts[record.attributeName]++
    }
  }).observe(root, { attributes: true, attributeFilter: Object.keys(counts), subtree: true })
}

// Executed by Page.probe in the isolated diagnostic tab. Keep native timings and
// stacks out of plain A/B runs. Record samples in a bounded array.
export function observeSubmissionAndLayout() {
  const samples = []
  window.__pbBenchCalls = samples
  function observe(prototype, key, property) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
    const native = descriptor?.[property]
    if (typeof native !== 'function' || !descriptor.configurable) return
    Object.defineProperty(prototype, key, { ...descriptor, [property]: function (...args) {
      const start = performance.now()
      const result = Reflect.apply(native, this, args)
      const ms = performance.now() - start
      if (ms >= 1 && samples.length < 20000) {
        const element = this instanceof Element ? this.getAttribute('class') : null
        samples.push({ start, ms, key, element, bytes: args[1]?.byteLength ?? args[2]?.byteLength ?? null })
      }
      return result
    } })
  }
  for (const key of ['clientWidth', 'clientHeight']) observe(Element.prototype, key, 'get')
  observe(Element.prototype, 'getBoundingClientRect', 'value')
  for (const key of ['bufferData', 'bufferSubData']) observe(WebGL2RenderingContext.prototype, key, 'value')
}

// Keep recorded trace bytes out of the timed page and stream them to disk after the window.
export async function startTimelineTrace(client) {
  const complete = new Promise(resolve => client.on('Tracing.tracingComplete', resolve))
  await client.send('Tracing.start', {
    categories: 'devtools.timeline,blink.user_timing,v8',
    transferMode: 'ReturnAsStream',
  })
  return async function saveTrace(path) {
    await client.send('Tracing.end')
    const { stream, dataLossOccurred } = await complete
    if (!stream) throw new Error('Chrome did not return a trace')
    let file
    try {
      file = await open(path, 'wx')
      let eof = false
      while (!eof) {
        const part = await client.send('IO.read', { handle: stream, size: 1024 * 1024 })
        await file.writeFile(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'))
        eof = part.eof
      }
    } finally {
      await file?.close()
      await client.send('IO.close', { handle: stream })
    }
    if (dataLossOccurred) throw new Error('Chrome reported trace data loss')
  }
}
