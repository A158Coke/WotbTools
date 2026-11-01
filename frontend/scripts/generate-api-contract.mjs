import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import standaloneCode from 'ajv/dist/standalone/index.js'
import { _ } from 'ajv/dist/compile/codegen/index.js'
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

// Compile once at generation time: WebView CSP never needs runtime eval/new Function.
const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true, esm: true, formats: _`formats` } })
addFormats(ajv)
ajv.addSchema({ ...schema, $id: 'wotb-playback' }, 'playback')
ajv.addSchema({ ...schema, $id: 'wotb-api-error', $ref: '#/$defs/ApiError' }, 'api-error')
const exports = { validator: 'playback', apiErrorValidator: 'api-error' }
function responseDefinitions(root) {
  const definitions = {}
  function add(name) {
    if (name in definitions) return
    const value = rewriteRefs(components[name])
    definitions[name] = value
    function visit(node) {
      if (!node || typeof node !== 'object') return
      for (const [key, child] of Object.entries(node)) {
        if (key === '$ref' && typeof child === 'string' && child.startsWith('#/$defs/')) add(child.slice('#/$defs/'.length))
        else visit(child)
      }
    }
    visit(value)
  }
  add(root)
  return definitions
}
for (const name of ['BattleDataRequest', 'BattleDataAdminSummary', 'BattleDataAdminPage', 'BattleDataAdminDetail', 'TournamentEvent', 'TournamentConfig', 'TournamentStandings', 'TournamentDayView',
  'TournamentDefaultRules', 'TournamentRuleSource',
  'TournamentAudit', 'TournamentRecognitionPermit', 'TournamentRecognitionResult',
  'TournamentHistoricalPreview', 'TournamentHistoricalPreviewRequest', 'TournamentHistoricalState',
  'TournamentCsvImportPreview', 'TournamentDataSource',
  'OnboardingReceipt', 'SaveOnboardingReceipt',
  'HallOfFamePage', 'HallOfFameRecord', 'PersonalHallOfFameRecord',
  'HofVehicleOption', 'HofAdminPage', 'HofAdminAuditPage', 'Mark3CreateResult', 'Mark3SubmissionSummary', 'Mark3UserStatus', 'Mark3LeaderboardPage', 'Mark3AdminPage', 'Mark3AdminDetail', 'Mark3ReplayEvidence', 'HofUploadResponse',
  'UserProfile', 'AdminUserPage', 'AdminUserDetail', 'DeleteUsersResponse',
  'CreateAiReviewFeedbackResponse', 'AdminAiReviewFeedbackPage', 'AdminAiReviewFeedbackDetail',
  'HundredLeaderboardPage', 'HundredCreateResult', 'HundredSubmissionSummary', 'HundredUserStatus',
  'HundredAdminPage', 'HundredAdminDetail', 'HundredReplayEvidence', 'BulkDeleteResult',
  'CreatorLevel', 'CreatorNameRequest', 'BackendHealth',
  'RecommendationType', 'RecommendationCategory', 'RecommendationCard', 'RecommendationDetail',
  'RecommendationSaveRequest', 'RecommendationCategoryRequest', 'RecommendationMetadata',
  'BroadcastSeason', 'BroadcastCategory', 'BroadcastReplay', 'BroadcastNode', 'BroadcastIndex', 'BroadcastSeasonView', 'BroadcastSeasonContents', 'BroadcastTimedCategoryView', 'BroadcastTimedReplaySave', 'BroadcastDeletionPreview', 'BroadcastSeasonCreate', 'BroadcastSeasonUpdate', 'BroadcastCategoryCreate', 'BroadcastNodeCreate', 'BroadcastReplaySave']) {
  if (!components[name]) continue
  const id = `tournament-${name}`
  ajv.addSchema({ $schema: schema.$schema, $id: id, $ref: `#/$defs/${name}`, $defs: responseDefinitions(name) }, id)
  exports[`${name[0].toLowerCase()}${name.slice(1)}Validator`] = id
}
// Ajv's ESM mode still emits a CommonJS reference for its Unicode length helper.
// Keep the generated module loadable directly in browsers and Android's strict CSP.
const validators = standaloneCode(ajv, exports)
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length')
  .replaceAll('require("ajv/dist/runtime/equal").default', 'equal')
if (/\brequire\s*\(/.test(validators)) {
  throw new Error('Generated validator contains an unmapped CommonJS runtime helper')
}
await writeFile(new URL('../src/api/generated/contract-validators.js', import.meta.url),
  '// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/http/openapi.yaml\n'
  + "import { fullFormats as formats } from 'ajv-formats/dist/formats.js';\n"
  + "import unicodeLengthModule from 'ajv/dist/runtime/ucs2length.js';\n"
  + "import equalModule from 'ajv/dist/runtime/equal.js';\n"
  // Node native ESM and Vite interoperate differently with this CJS default export.
  + 'const ucs2length = unicodeLengthModule.default ?? unicodeLengthModule;\n'
  + 'const equal = equalModule.default ?? equalModule;\n'
  + validators + '\n', 'utf8')

// contracts/android-native-bridge.json → TS。响应类型只作消费方 guard 的收窄目标，不能当 transport 的断言。
const bridgeContract = JSON.parse(await readFile(new URL('../../contracts/android-native-bridge.json', import.meta.url), 'utf8'))

function bridgeFields(fields, indent) {
  const pad = ' '.repeat(indent)
  const lines = Object.entries(fields).map(([name, spec]) =>
    `${pad}  ${name}${spec.required === false ? '?' : ''}: ${bridgeType(spec, indent + 2)}`)
  return lines.length ? `{\n${lines.join('\n')}\n${pad}}` : 'Record<string, never>'
}

function bridgeBaseType(spec, indent) {
  switch (spec.type) {
    case 'string': return spec.enum ? spec.enum.map(value => `'${value}'`).join(' | ') : 'string'
    case 'integer': return 'number'
    case 'boolean': return 'boolean'
    case 'string[]': return 'string[]'
    case 'object': return spec.fields ? bridgeFields(spec.fields, indent) : 'Record<string, unknown>'
    case 'object[]': return `Array<${bridgeFields(spec.fields, indent)}>`
    default: throw new Error(`Unsupported Native Bridge contract type: ${spec.type}`)
  }
}

function bridgeType(spec, indent) {
  const type = bridgeBaseType(spec, indent)
  return spec.nullable ? `${type} | null` : type
}

const bridgeMethods = Object.entries(bridgeContract.methods).map(([name, method]) => [
  `  ${name}: {`,
  `    request: ${bridgeFields(method.request.fields, 4)}`,
  `    response: ${bridgeType(method.response, 4)}`,
  '  }',
].join('\n'))
await writeFile(new URL('../src/api/generated/android-native-bridge.ts', import.meta.url), [
  '// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/android-native-bridge.json',
  `export type NativeBridgeCapability = ${bridgeContract.capabilities.map(value => `'${value}'`).join(' | ')}`,
  '',
  'export interface NativeBridgeMethods {',
  ...bridgeMethods,
  '}',
  '',
  'export type NativeBridgeMethod = keyof NativeBridgeMethods',
  "export type NativeBridgeRequest<M extends NativeBridgeMethod> = NativeBridgeMethods[M]['request']",
  "export type NativeBridgeResponse<M extends NativeBridgeMethod> = NativeBridgeMethods[M]['response']",
  '',
].join('\n'), 'utf8')
