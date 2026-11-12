import { describe, expect, it } from 'vitest'
import { useAnnotationState } from './useAnnotationState.js'
import type { MapAnnotation } from './useAnnotationState.js'

function pen(id: string): MapAnnotation {
  return { type: 'pen', color: '#ff0000', id, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
}

function historyIds(history: MapAnnotation[][]): (string | undefined)[][] {
  return history.map((snap) => snap.map((a) => a.id as string | undefined))
}

describe('useAnnotationState', () => {
  it('starts empty with a single initial snapshot', () => {
    const s = useAnnotationState()
    expect(s.annotations.value).toEqual([])
    expect(s.history.value).toEqual([[]])
    expect(s.historyIndex.value).toBe(0)
    expect(s.selectedAnnotation.value).toBeNull()
    expect(s.draft.value).toBeNull()
  })

  it('commitDraft appends and grows the snapshot stack', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.commitDraft(pen('b'))
    expect(s.annotations.value.map((a) => a.id)).toEqual(['a', 'b'])
    expect(historyIds(s.history.value)).toEqual([[], ['a'], ['a', 'b']])
    expect(s.historyIndex.value).toBe(2)
  })

  it('undo / redo move along snapshots and clear the selection', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.commitDraft(pen('b'))
    s.selectedAnnotationIndex.value = 1
    s.undo()
    expect(s.annotations.value.map((a) => a.id)).toEqual(['a'])
    expect(s.selectedAnnotationIndex.value).toBe(-1)
    s.redo()
    expect(s.annotations.value.map((a) => a.id)).toEqual(['a', 'b'])
    // 边界保护：栈尾 redo / 栈底 undo 都是无操作，历史与选中不被破坏
    s.redo()
    expect(s.historyIndex.value).toBe(2)
    s.undo(); s.undo()
    expect(s.historyIndex.value).toBe(0)
    expect(s.annotations.value).toEqual([])
    s.undo()
    expect(s.historyIndex.value).toBe(0)
  })

  it('commit after undo discards the redo side', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.commitDraft(pen('b'))
    s.undo()
    s.commitDraft(pen('c'))
    expect(s.annotations.value.map((a) => a.id)).toEqual(['a', 'c'])
    expect(historyIds(s.history.value)).toEqual([[], ['a'], ['a', 'c']])
  })

  it('clearAll commits an empty snapshot only when there is something to clear', () => {
    const s = useAnnotationState()
    s.clearAll()
    expect(s.history.value).toEqual([[]])
    s.commitDraft(pen('a'))
    s.selectedAnnotationIndex.value = 0
    s.clearAll()
    expect(s.annotations.value).toEqual([])
    expect(s.history.value).toEqual([[], [{ type: 'pen', color: '#ff0000', id: 'a', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }], []])
    expect(s.selectedAnnotationIndex.value).toBe(-1)
  })

  it('updateSelected patches only the selected annotation snapshot', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.commitDraft(pen('b'))
    s.selectedAnnotationIndex.value = 1
    s.updateSelected({ color: '#00ff00' })
    expect(s.annotations.value[1].color).toBe('#00ff00')
    expect(s.annotations.value[0].color).toBe('#ff0000')
    expect(s.history.value).toHaveLength(4)
  })

  it('deleteSelected removes the selected annotation and clears the selection', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.commitDraft(pen('b'))
    s.selectedAnnotationIndex.value = 0
    s.deleteSelected()
    expect(s.annotations.value.map((a) => a.id)).toEqual(['b'])
    expect(s.selectedAnnotationIndex.value).toBe(-1)
    // 无选中时删除是无操作
    s.deleteSelected()
    expect(s.annotations.value.map((a) => a.id)).toEqual(['b'])
  })

  it('renameSelected writes text for text annotations and label otherwise, trimmed to 60 chars', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.selectedAnnotationIndex.value = 0
    s.renameSelected('  alpha  ')
    expect(s.annotations.value[0].label).toBe('alpha')
    s.commitDraft({ type: 'text', color: '#fff', text: '' })
    s.selectedAnnotationIndex.value = 1
    s.renameSelected(`x`.repeat(80))
    expect(s.annotations.value[1].text).toBe('x'.repeat(60))
    expect(s.annotations.value[1].label).toBeUndefined()
  })

  it('finishRoute commits a route of >= 2 points and selects it; shorter routes are rejected', () => {
    let route: MapAnnotation | null = null
    const s = useAnnotationState({ getRouteDraft: () => route })
    route = { type: 'route', color: '#fff', points: [{ x: 0, y: 0 }] }
    expect(s.finishRoute()).toBe(false)
    expect(s.history.value).toEqual([[]])
    route = { type: 'route', color: '#fff', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    expect(s.finishRoute()).toBe(true)
    expect(s.annotations.value).toHaveLength(1)
    expect(s.annotations.value[0].type).toBe('route')
    expect(s.selectedAnnotationIndex.value).toBe(0)
  })

  it('an out-of-range selection yields no selected annotation and update/delete are no-ops', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.selectedAnnotationIndex.value = 5
    expect(s.selectedAnnotation.value).toBeNull()
    s.updateSelected({ color: '#00ff00' })
    s.deleteSelected()
    expect(s.annotations.value).toHaveLength(1)
    expect(s.annotations.value[0].color).toBe('#ff0000')
    expect(s.history.value).toHaveLength(2)
  })

  it('reset returns history, draft and selection to the initial state (file switch)', () => {
    const s = useAnnotationState()
    s.commitDraft(pen('a'))
    s.draft.value = pen('draft')
    s.selectedAnnotationIndex.value = 0
    s.reset()
    expect(s.history.value).toEqual([[]])
    expect(s.historyIndex.value).toBe(0)
    expect(s.annotations.value).toEqual([])
    expect(s.draft.value).toBeNull()
    expect(s.selectedAnnotationIndex.value).toBe(-1)
  })
})
