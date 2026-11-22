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
            // renderOrder 不随父级继承，必须写在 mesh 上：球壳先画（996），轨迹线/命中
            // 标记后画，否则按距离排序可能让球壳的橙色薄涂在轨迹线上。
            sphere.renderOrder = 996;
            group.add(sphere);
            group.visible = getPenetrationMode();
            getFxScene().add(group);
            heSplashGroup = group;
        }

  return { disposeHeSplashVisual, updateHeSplashVisual, getGroup: () => heSplashGroup }
}
