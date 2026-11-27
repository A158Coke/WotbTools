export function normalizeHeadings(input) {
  if (!input) return input
  const lines = input.split('\n')
  let inFence = false
  const out = []
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (!inFence) {
      out.push(line.replace(/^(#{1,6})(?!#|\s)/, '$1 '))
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}
