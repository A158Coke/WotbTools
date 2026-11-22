import { expect, it, vi } from 'vitest'
import { Group, Vector3 } from 'three'
import { createPlaybackSceneRoot } from './renderer'

it('keeps baked world matrices across passes while updating moving vehicle children', () => {
  const scene = createPlaybackSceneRoot()
  const map = new Group()
  const vehicle = new Group()
  const turret = new Group()
  map.position.x = 8
  map.updateMatrix()
  map.matrixAutoUpdate = false
  vehicle.add(turret)
  turret.position.x = 1
  scene.add(map, vehicle)
  scene.updateMatrixWorld()
  const multiply = vi.spyOn(map.matrixWorld, 'multiplyMatrices')
  for (const x of [3, 5, 2]) {
    vehicle.position.x = x
    scene.updateMatrixWorld()
    scene.updateMatrixWorld()
    expect(new Vector3().setFromMatrixPosition(turret.matrixWorld).x).toBe(x + 1)
    expect(new Vector3().setFromMatrixPosition(map.matrixWorld).x).toBe(8)
  }
  expect(multiply).not.toHaveBeenCalled()
})
