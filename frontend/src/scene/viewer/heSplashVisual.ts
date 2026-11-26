import * as THREE from 'three'
import type { HeatmapDeps } from './heatmap.js'

export function createHeSplashVisual(deps: Pick<HeatmapDeps, 'getFxScene' | 'getScene' | 'getPenetrationMode'>) {
  const { getFxScene, getScene, getPenetrationMode } = deps
  let heSplashGroup: THREE.Group | null = null
function disposeHeSplashVisual(): void {
            if (!heSplashGroup) return;
            getFxScene().remove(heSplashGroup);
            heSplashGroup.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                const mat = mesh.material as THREE.Material | undefined;
                if (mat) mat.dispose();
            });
            heSplashGroup = null;
        }

function updateHeSplashVisual(center: THREE.Vector3 | null, radius: number) {
            disposeHeSplashVisual();
            if (!getScene() || !center || !(radius > 0)) return;
            const group = new THREE.Group();
            group.position.copy(center);
            group.userData.radius = radius;
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(radius, 48, 24),
                new THREE.MeshBasicMaterial({
                    color: 0xffaa00, transparent: true, opacity: 0.07,
                    depthWrite: false, depthTest: false, side: THREE.DoubleSide,
                }),
            );
            sphere.raycast = () => {};
            sphere.renderOrder = 995;
            group.add(sphere);
            group.visible = getPenetrationMode();
            getFxScene().add(group);
            heSplashGroup = group;
        }

  return { disposeHeSplashVisual, updateHeSplashVisual, getGroup: () => heSplashGroup }
}
