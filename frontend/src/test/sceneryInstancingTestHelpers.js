import * as THREE from 'three'

// Pure factories: every invocation creates a fresh mutable Three.js object.
export const geo = (h = 1) => {
  const g = new THREE.BoxGeometry(1, h, 1)
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5 + h - 1, 0.5))
  return g
}

export const mat = () => new THREE.MeshLambertMaterial()
