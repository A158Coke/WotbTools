import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

const SRC = fileURLToPath(new URL('../', import.meta.url))

const BASELINE = [
  'components/HoFAdminRecords.vue#fBattleType=RANDOM|RATING',
  'components/HoFAdminRecords.vue#fReplayAvailable=true|false',
  'components/HoFAdminRecords.vue#fSort=battle_time|upload_time',
  'components/HofSingleBoard.vue#battleType=RANDOM|RATING',
]

interface TemplateProp {
  type: number
  name: string
  value?: unknown
  arg?: unknown
  exp?: unknown
}

interface TemplateNode {
  type: number
  tag?: string
  props?: TemplateProp[]
  children?: unknown[]
  loc: { source: string }
}

const ELEMENT = 1
const ATTRIBUTE = 6

function content(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null || !('content' in node)) return undefined
  return typeof node.content === 'string' ? node.content : undefined
}

const directive = (node: TemplateNode, name: string, arg?: string) =>
  node.props?.find(prop => prop.type !== ATTRIBUTE && prop.name === name && (arg === undefined || content(prop.arg) === arg))
const attribute = (node: TemplateNode, name: string) =>
  node.props?.find(prop => prop.type === ATTRIBUTE && prop.name === name)
const isElement = (node: unknown): node is TemplateNode =>
  typeof node === 'object' && node !== null && 'type' in node && node.type === ELEMENT
const elements = (node: TemplateNode) => (node.children ?? []).filter(isElement)

function staticOptions(node: TemplateNode): TemplateNode[] | null {
  const options: TemplateNode[] = []
  for (const child of elements(node)) {
    if (directive(child, 'for')) return null
    if (child.tag === 'option') options.push(child)
    else {
      const nested = staticOptions(child)
      if (!nested) return null
      options.push(...nested)
    }
  }
  return options
}

function optionValue(option: TemplateNode) {
  return content(attribute(option, 'value')?.value) ?? content(directive(option, 'bind', 'value')?.exp)
    ?? option.loc.source.replace(/<[^>]+>/g, '').trim()
}

function isPlaceholder(option: TemplateNode) {
  const hasValue = attribute(option, 'value') || directive(option, 'bind', 'value')
  return !!attribute(option, 'disabled') || (!!hasValue && ['', "''", '""'].includes(optionValue(option)))
}

function selects(node: TemplateNode): TemplateNode[] {
  return elements(node).flatMap(child => [...(child.tag === 'select' ? [child] : []), ...selects(child)])
}

function smallStaticSelects(file: string, source: string) {
  const root = parse(source).descriptor.template?.ast
  if (!root) return []
  return selects(root).flatMap((select) => {
    if (attribute(select, 'multiple')) return []
    const candidates = staticOptions(select)?.filter(option => !isPlaceholder(option)) ?? []
    if (candidates.length === 0 || candidates.length > 2) return []
    const binding = content(directive(select, 'model')?.exp) ?? content(directive(select, 'bind', 'value')?.exp) ?? ''
    return [`${file}#${binding}=${candidates.map(optionValue).join('|')}`]
  })
}

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return path.endsWith('.vue') ? [path] : []
  })
}

describe('selection control policy', () => {
  const found = vueFiles(SRC).flatMap(path =>
    smallStaticSelects(relative(SRC, path).split(sep).join('/'), readFileSync(path, 'utf8'))).sort()

  const scan = (body: string) => smallStaticSelects('x.vue', `<template>${body}</template>`)

  it('counts real candidates, not option tags', () => {
    expect(scan('<select v-model="a"><option>a</option><option>b</option></select>')).toEqual(['x.vue#a=a|b'])
    expect(scan('<select v-model="a"><option value="">choose</option><option value="a">A</option><option value="b">B</option></select>'))
      .toEqual(['x.vue#a=a|b'])
    expect(scan('<select v-model="a"><option :value="\'\'">all</option><option value="a">A</option><option value="b">B</option></select>'))
      .toEqual(['x.vue#a=a|b'])
    expect(scan('<select v-model="a"><option disabled>choose</option><option value="a">A</option><option value="b">B</option></select>'))
      .toEqual(['x.vue#a=a|b'])
    expect(scan('<select><option>a</option><option>b</option><option>c</option></select>')).toEqual([])
    expect(scan('<select multiple><option>a</option><option>b</option></select>')).toEqual([])
  })

  it('leaves runtime-populated selects to manual review', () => {
    expect(scan('<select><option value="">a</option><option v-for="x in xs">{{ x }}</option></select>')).toEqual([])
    expect(scan('<select :disabled="a > b"><option value="">a</option><option v-for="x in xs">{{ x }}</option></select>')).toEqual([])
    expect(scan('<select><template v-for="x in xs"><option>{{ x }}</option></template></select>')).toEqual([])
    expect(scan('<select id="filled-by-js"></select>')).toEqual([])
  })

  it('identifies each violation so swapping one for another cannot keep the baseline green', () => {
    expect(scan('<select v-model="a"><option>x</option><option>y</option></select>'))
      .not.toEqual(scan('<select v-model="b"><option>x</option><option>y</option></select>'))
    expect(scan('<select v-model="a"><option>x</option><option>y</option></select>'))
      .not.toEqual(scan('<select v-model="a"><option>x</option><option>z</option></select>'))
  })

  it('finds selects nested anywhere in the template', () => {
    expect(scan('<div v-if="a"><label><select v-model="b"><option>x</option></select></label></div>')).toEqual(['x.vue#b=x'])
  })

  it('has no two-option dropdown outside the shrinking baseline', () => {
    expect(found).toEqual([...BASELINE].sort())
  })
})
