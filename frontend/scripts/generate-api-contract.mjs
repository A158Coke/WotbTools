import { readFile, writeFile } from 'node:fs/promises'
import { parse } from 'yaml'

const input = new URL('../../contracts/http/openapi.yaml', import.meta.url)
const output = new URL('../src/api/generated/playback-v2.schema.ts', import.meta.url)
const errorCodesOutput = new URL('../src/api/generated/api-error-codes.ts', import.meta.url)
const document = parse(await readFile(input, 'utf8'))
const components = document.components?.schemas || {}

function rewriteRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteRefs)
  if (!value || typeof value !== 'object') return value
  const copy = {}
  for (const [key, child] of Object.entries(value)) {
    copy[key] = typeof child === 'string' && child.startsWith('#/components/schemas/')
      ? child.replace('#/components/schemas/', '#/$defs/')
      : rewriteRefs(child)
  }
  return copy
}

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $ref: '#/$defs/BattlePlaybackDataset',
  $defs: Object.fromEntries(Object.entries(components).map(([name, value]) => [name, rewriteRefs(value)])),
}
const source = `// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/http/openapi.yaml\nexport default ${JSON.stringify(schema, null, 2)} as const\n`
await writeFile(output, source, 'utf8')
const errorCodes = components.ApiErrorCode?.enum || []
await writeFile(errorCodesOutput,
  `// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/http/openapi.yaml\nexport const API_ERROR_CODES = ${JSON.stringify(errorCodes)} as const\n`,
  'utf8')
