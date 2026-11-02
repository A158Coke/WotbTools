import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ANNOTATION_MAX_SURFACE_CANDIDATES,
  ANNOTATION_SURFACE_MIN_CLEARANCE,
  buildAnnotationSurfaceGrid,
  chooseAnnotationHit,
  collectSurfaceCandidates,
  isDrawableSurfaceHit,
  pickDrawableSurfaceHit,
} from './annotationSurface.ts'
import { hitWorldNormalY } from './annotation3d.js'

function cameraFromAbove(y = 30) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000)
  camera.position.set(0, y, 0)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
  return { camera, raycaster }
}

function box(w, h, d, x, y, z, material = new THREE.MeshBasicMaterial()) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.updateMatrixWorld(true)
  return mesh
}

const ground = () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial())
  mesh.rotation.x = -Math.PI / 2
  mesh.updateMatrixWorld(true)
  return mesh
}

describe('annotation surface picking policy', () => {
  it('selects the nearer bridge deck over the terrain below it', () => {
    const floor = ground()
    const bridge = box(20, 1, 10, 0, 8, 0)
    const { raycaster } = cameraFromAbove()
    const hit = pickDrawableSurfaceHit(raycaster, [bridge, floor], () => 0)
    expect(hit).not.toBeNull()
    expect(hit.object).toBe(bridge)
    expect(hit.point.y).toBeCloseTo(8.5, 5)
    expect(hitWorldNormalY(hit)).toBeCloseTo(1, 5)
  })

  it('falls through when the bridge is hidden or tagged non-drawable', () => {
    const floor = ground()
    const { raycaster } = cameraFromAbove()

    const hidden = box(20, 1, 10, 0, 8, 0)
    hidden.visible = false
    expect(pickDrawableSurfaceHit(raycaster, [hidden, floor], () => 0)).toBeNull()

    const tagged = box(20, 1, 10, 0, 8, 0)
    tagged.material.userData.annotationSurface = false
    expect(pickDrawableSurfaceHit(raycaster, [tagged, floor], () => 0)).toBeNull()
  })

  it('rejects vertical walls', () => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.MeshBasicMaterial())
    wall.position.set(0, 5, 0)
    wall.updateMatrixWorld(true)
    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000)
    camera.position.set(0, 5, 20)
    camera.lookAt(0, 5, 0)
    camera.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
    const hit = raycaster.intersectObject(wall, false)[0]
    expect(hit).toBeTruthy()
    expect(hitWorldNormalY(hit)).toBeCloseTo(0, 5)
    expect(isDrawableSurfaceHit(hit, 0)).toBe(false)
  })

  it('accepts a rough elevated bridge face but rejects a low flat terrain plate', () => {
    const { raycaster } = cameraFromAbove()
    const bridgeFace = box(20, 1, 10, 0, 8, 0)
    bridgeFace.rotation.x = Math.PI / 4 // 45°: stone/roof facet, but elevated
    bridgeFace.updateMatrixWorld(true)
    expect(pickDrawableSurfaceHit(raycaster, [bridgeFace], () => 0)).not.toBeNull()

    const plate = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial())
    plate.rotation.x = -Math.PI / 2
    plate.position.y = 0.1
    plate.updateMatrixWorld(true)
    const plateHit = raycaster.intersectObject(plate, false)[0]
    expect(plateHit).toBeTruthy()
    expect(plateHit.point.y - 0 < ANNOTATION_SURFACE_MIN_CLEARANCE).toBe(true)
    expect(isDrawableSurfaceHit(plateHit, 0)).toBe(false)
  })

  it('keeps up-facing normals through the rotated map root', () => {
    const root = new THREE.Group()
    root.rotation.order = 'YXZ'
    root.rotation.set(-Math.PI / 2, Math.PI, 0)
    const bridge = box(20, 10, 1, 0, 0, 8)
    root.add(bridge)
    root.updateMatrixWorld(true)
    const { raycaster } = cameraFromAbove()
    const hit = pickDrawableSurfaceHit(raycaster, [bridge])
    expect(hit).not.toBeNull()
    expect(hit.point.y).toBeCloseTo(8.5, 4)
    expect(hitWorldNormalY(hit)).toBeCloseTo(1, 4)
  })

  it('transforms instance normals through the instance matrix', () => {
    const geometry = new THREE.BoxGeometry(20, 1, 10)
    const material = new THREE.MeshBasicMaterial()
    const instanced = new THREE.InstancedMesh(geometry, material, 1)
    const matrix = new THREE.Matrix4().makeTranslation(0, 8, 0)
    instanced.setMatrixAt(0, matrix)
    instanced.instanceMatrix.needsUpdate = true
    instanced.updateMatrixWorld(true)
    const { raycaster } = cameraFromAbove()
    const hit = raycaster.intersectObject(instanced, false)[0]
    expect(hit).toBeTruthy()
    expect(hitWorldNormalY(hit)).toBeCloseTo(1, 5)
  })

  it('builds a footprint grid and skips material-tagged / hidden batches', () => {
    const drawable = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const taggedMaterial = new THREE.MeshBasicMaterial()
    taggedMaterial.userData.annotationSurface = false
    const tagged = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), taggedMaterial)
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())

    const batches = [
      { mesh: drawable, geometry: { boundingSphere: new THREE.Sphere(new THREE.Vector3(), 5) }, material: drawable.material, items: [{ x: 0, y: 0 }] },
      { mesh: tagged, geometry: { boundingSphere: new THREE.Sphere(new THREE.Vector3(), 5) }, material: taggedMaterial, items: [{ x: 0, y: 0 }] },
      { mesh: hidden, geometry: { boundingSphere: new THREE.Sphere(new THREE.Vector3(), 5) }, material: hidden.material, items: [{ x: 0, y: 0, hidden: true }] },
    ]

    const grid = buildAnnotationSurfaceGrid(batches)
    const all = [...grid.values()].flat()
    expect(all).toContain(drawable)
    expect(all).not.toContain(tagged)
    expect(all).not.toContain(hidden)
    expect(grid.has('0,0')).toBe(true)
  })

  it('does not let one item-level tag poison the whole instance batch', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const batch = {
      mesh,
      geometry: { boundingSphere: new THREE.Sphere(new THREE.Vector3(), 5) },
      material: mesh.material,
      // 旧实现会把任一 node.userData.annotationSurface=false 当成整批不可绘制；
      // 批次只共享 geometry/material，item 级 tag 不得连坐（bridge + ground plate 同批）。
      items: [
        { x: 0, y: 0, node: { userData: { annotationSurface: false } } },
        { x: 0, y: 0, node: { userData: {} } },
      ],
    }
    const grid = buildAnnotationSurfaceGrid([batch])
    expect([...grid.values()].flat()).toContain(mesh)
  })

  it('uses transformed boundingSphere center and instance scale for the footprint', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const identity = new THREE.Matrix4()
    const offsetBatch = {
      mesh,
      geometry: {
        boundingSphere: { center: new THREE.Vector3(40, 0, 0), radius: 2 },
      },
      material: mesh.material,
      items: [{ x: 0, y: 0, matrix: { elements: identity.elements } }],
    }
    const offsetGrid = buildAnnotationSurfaceGrid([offsetBatch])
    expect(offsetGrid.has('2,0')).toBe(true)
    expect(offsetGrid.has('0,0')).toBe(false)

    const scaled = new THREE.Matrix4().makeScale(10, 1, 1)
    const scaledBatch = {
      ...offsetBatch,
      geometry: { boundingSphere: { center: new THREE.Vector3(0, 0, 0), radius: 2 } },
      items: [{ x: 0, y: 0, matrix: { elements: scaled.elements } }],
    }
    const scaledGrid = buildAnnotationSurfaceGrid([scaledBatch])
    expect(scaledGrid.has('1,0')).toBe(true)
    expect(scaledGrid.has('-1,0')).toBe(true)
  })

  it('projects gltf-local item coordinates into world XZ when asked', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const batch = {
      mesh,
      geometry: { boundingSphere: new THREE.Sphere(new THREE.Vector3(), 5) },
      material: mesh.material,
      items: [{ x: 10, y: 0, node: mesh }],
    }
    const localGrid = buildAnnotationSurfaceGrid([batch])
    const worldGrid = buildAnnotationSurfaceGrid([batch], { project: (item) => ({ x: -item.x, z: item.y }) })
    expect(localGrid.has('0,0')).toBe(true)
    expect(worldGrid.has('-1,0')).toBe(true)
    expect(worldGrid.has('0,0')).toBe(false)
  })

  it('dedupes candidates and fails open over the candidate budget', () => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    const grid = new Map([['x', [a, b]], ['y', [b, c]]])
    expect(collectSurfaceCandidates(grid, ['x', 'y'])).toEqual([a, b, c])
    expect(collectSurfaceCandidates(grid, ['x'], 0)).toBeNull()
    expect(ANNOTATION_MAX_SURFACE_CANDIDATES).toBeGreaterThan(0)
  })

  it('chooses the nearer of ground and surface hits, handling missing candidates', () => {
    const groundHit = { point: new THREE.Vector3(0, 0, 0), distance: 10 }
    const surfaceHit = { point: new THREE.Vector3(0, 8, 0), distance: 5 }
    expect(chooseAnnotationHit(groundHit, surfaceHit)).toBe(surfaceHit)
    expect(chooseAnnotationHit({ ...groundHit, distance: 20 }, surfaceHit)).toBe(surfaceHit)
    expect(chooseAnnotationHit(groundHit, null)).toBe(groundHit)
    expect(chooseAnnotationHit(null, surfaceHit)).toBe(surfaceHit)
    expect(chooseAnnotationHit(null, null)).toBeNull()
  })
})
