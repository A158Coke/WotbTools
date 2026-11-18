import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyCrew, parseComparison, readComparisonDocument, readComparisonSeed, saveComparison, type ComparisonEntry } from './tankMobility'
import ussr from '../replay-local/compute/__fixtures__/modules/ussr.json'
import skills from '../replay-local/compute/__fixtures__/research/skills.json'
import { buildComputeInput } from '../replay-local/compute/tankSetup'
import { crewForEntry, projectMobilitySetup, matchesSnapshot, moduleIdentity, selectionQuery, mobilityVehicle } from './tankMobility'

const modules = ussr.tanks['T-34']
const selection = {
  canConfigure: true, config: 0, engine: 0, track: 0, turret: 0, gun: 0, shell: 0,
  devices: Array(9).fill(null), provisions: [], consumables: [], skills: { virtuoso: 3 },
  conditionalSkills: false, camouflage: true,
}
const one: ComparisonEntry = { id: 'one', tank: 1, dataset: 'wg', activations: {},
  config: selectionQuery(selection), stems: moduleIdentity(modules, selection) }
const two = { ...one, id: 'two', config: { ...one.config!, skills: { virtuoso: 7 }, conditionalSkills: true } }
afterEach(() => vi.unstubAllGlobals())
describe('comparison document migration', () => {
  it('keeps differing v1 skills as explicit overrides and lifts a uniform list to global skills', () => {
    const loaded = parseComparison([one, two], ['virtuoso'])
    expect(loaded.status).toBe('ready')
    if (loaded.status !== 'ready') throw Error()
    expect(loaded.document.crew).toEqual({ skills: { virtuoso: 3 }, conditionalSkills: false })
    expect(loaded.document.legacyCrewOverrides).toEqual({ two: { skills: { virtuoso: 7 }, conditionalSkills: true } })
    expect(parseComparison([one, { ...one, id: 'another' }])).toMatchObject({ document: { crew: loaded.document.crew } })
    const uniform = parseComparison([one, { ...one, id: 'another' }])
    expect(uniform.status).toBe('ready')
    if (uniform.status !== 'ready') throw Error()
    expect(uniform.document.legacyCrewOverrides).toBeUndefined()
  })
  it('reads both seed versions and keeps global skills in an empty saved comparison', () => {
    const legacy = readComparisonSeed(JSON.stringify({ v: 1, vehicle: one }))
    expect(legacy.status).toBe('ready')
    if (legacy.status !== 'ready') throw Error()
    const empty = { ...legacy.document, entries: [], crew: { skills: { virtuoso: 5 }, conditionalSkills: true } }
    saveComparison('empty-v2', empty)
    expect(readComparisonDocument('empty-v2')).toEqual({ status: 'ready', document: empty })
    expect(readComparisonSeed(JSON.stringify(empty))).toEqual({ status: 'ready', document: empty })
  })
  it('rejects unknown versions, bad levels/IDs and overrides for missing instances', () => {
    expect(parseComparison({v: 99, entries: []})).toEqual({status:'unsupported'})
    expect(parseComparison([{...one,config:{...one.config,skills:{virtuoso:8}}}]).status).toBe('invalid')
    expect(parseComparison([one], ['other'])).toEqual({status:'invalid'})
    expect(parseComparison({v:2,entries:[one],crew:emptyCrew(),legacyCrewOverrides:{missing:emptyCrew()}}).status).toBe('invalid')
    expect(parseComparison([one,one]).status).toBe('invalid')
  })
  it('preserves the old stored value until a replacement is written and falls back to memory on storage failure', () => {
    const original = JSON.stringify([one, two])
    const data = new Map([['tank-mobility-v1:storage-1016', original]])
    vi.stubGlobal('sessionStorage',{getItem:(key:string)=>data.get(key)??null,setItem:()=>{throw Error('quota')}})
    const loaded = readComparisonDocument('storage-1016')
    expect(loaded.status).toBe('ready')
    expect(data.get('tank-mobility-v1:storage-1016')).toBe(original)
    if (loaded.status !== 'ready') throw Error()
    const next = { ...loaded.document, crew: emptyCrew(), legacyCrewOverrides: undefined }
    expect(saveComparison('storage-1016', next)).toBe('memory')
    expect(data.get('tank-mobility-v1:storage-1016')).toBe(original)
    expect(readComparisonDocument('storage-1016')).toMatchObject({ document: { crew: emptyCrew() } })
  })
})

it('validates the carried snapshot before projecting crew and ignores paint in comparison curves', () => {
  expect(matchesSnapshot(one, modules, selection)).toBe(true)
  const projected = projectMobilitySetup(selection, {skills:{virtuoso:7},conditionalSkills:true})
  expect(projected.camouflage).toBe(false)
  expect(selection.camouflage).toBe(true)
  expect(projected.skills).toEqual({virtuoso:7})
  expect(matchesSnapshot(one, modules, projected)).toBe(false)
  const detail = {tier:5,type:'mediumTank',configs:[{shells:[]}]}
  const catalog = {devices:[],devicePresets:{},consumables:[],provisions:[],skills:skills.items}
  const input = buildComputeInput({detail,modules,selection:projected,catalog})
  const base = mobilityVehicle({id:'car',name:'car',color:'blue',summary:'',input,catalog})
  const otherPaint = mobilityVehicle({id:'car',name:'car',color:'blue',summary:'',input:{...input,camouflage:true},catalog})
  expect(base.mobility).toEqual(otherPaint.mobility)
  expect(base.phases).toEqual(otherPaint.phases)
})

it('treats legacy instance IDs as data when resolving skill overrides', () => {
  const loaded=parseComparison([{...one,id:'constructor'},two])
  if(loaded.status!=='ready')throw Error()
  expect(crewForEntry(loaded.document,'constructor')).toEqual(loaded.document.crew)
  const entry={...one,id:'__proto__'}
  const v2=parseComparison({v:2,entries:[entry],crew:emptyCrew(),legacyCrewOverrides:Object.fromEntries([['__proto__',{skills:{virtuoso:7},conditionalSkills:false}]])})
  if(v2.status!=='ready')throw Error()
  expect(crewForEntry(v2.document,'__proto__').skills).toEqual({virtuoso:7})
  expect(JSON.parse(JSON.stringify(v2.document)).legacyCrewOverrides.__proto__.skills.virtuoso).toBe(7)
})
