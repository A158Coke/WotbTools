import * as THREE from 'three'
import { shellTypeOf, rolledPenetration } from './armorPlateModel.js'
import { shotBallisticLength } from '../agentData.js'
import type { HeatmapDeps } from './heatmap.js'
import type { createArmorShaderContext } from './armorShaders.js'

type PassDeps = Pick<HeatmapDeps, 'getRenderer' | 'getCamera' | 'getSelectedShell' | 'equipmentCoeffs' | 'getWorldMetersPerUnit'> & {
  getPrimaryArmorScene: () => THREE.Scene | null; getSpacedArmorScene: () => THREE.Scene | null; getSpacedStateScene: () => THREE.Scene | null
  syncPenetrationRT: () => THREE.WebGLRenderTarget; ensureSpacedStateRT: () => THREE.WebGLRenderTarget | null
  syncCloneMatrices: (obj: THREE.Object3D | null) => void; computeGunClipPlane: () => void
  getGunClipPlane: () => THREE.Plane | null; spacedRTFloatCapable: () => boolean
  rcUniforms: ReturnType<typeof createArmorShaderContext>['rcUniforms']
}
export function createHeatmapPasses(deps: PassDeps) {
  const { getRenderer, getCamera, getSelectedShell, equipmentCoeffs, getWorldMetersPerUnit, getPrimaryArmorScene,
    getSpacedArmorScene, getSpacedStateScene, syncPenetrationRT, ensureSpacedStateRT, syncCloneMatrices,
    computeGunClipPlane, getGunClipPlane, spacedRTFloatCapable, rcUniforms } = deps
function refreshPenetrationResolution() {
  const primaryArmorScene = getPrimaryArmorScene()
            const c = getRenderer().domElement;
            const apply = (obj: THREE.Scene) => obj.traverse(function(node) {
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (mesh.isMesh && mat && mat.uniforms && mat.uniforms.resolution) {
                    mat.uniforms.resolution.value.set(c.width, c.height);
                    if (mat.uniforms.metersPerUnit) {
                        mat.uniforms.metersPerUnit.value = getWorldMetersPerUnit() || 1;
                    }
                }
            });
            if (primaryArmorScene) apply(primaryArmorScene);
        }

function updatePenetrationDistanceUniforms() {
  const primaryArmorScene = getPrimaryArmorScene(), spacedArmorScene = getSpacedArmorScene(), spacedStateScene = getSpacedStateScene()
            const sh = getSelectedShell();
            if (!sh) return;
            const near = sh.penetration || 0;
            const isHE = shellTypeOf(sh) === 'he';
            const { penMul } = equipmentCoeffs();
            const origin = getCamera().position;
            const world = new THREE.Vector3();
            const shotLenForUniforms = (window.__shotCtx && window.__shotCtx.shot)
                ? shotBallisticLength(window.__shotCtx.shot) * (getWorldMetersPerUnit() || 1) : 0;
            const apply = (scene: THREE.Scene | null) => {
                if (!scene) return;
                scene.traverse(function(node) {
                    const mesh = node as THREE.Mesh;
                    const mat = mesh.material as THREE.ShaderMaterial | undefined;
                    if (!mesh.isMesh || !mat || !mat.uniforms || !mat.uniforms.penetration) return;
                    const src = node.userData._src as THREE.Object3D | null | undefined;
                    if (src) {
                        const g = mesh.geometry as THREE.BufferGeometry;
                        if (!g.boundingSphere) g.computeBoundingSphere();
                        src.updateWorldMatrix(true, false);
                        world.copy(g.boundingSphere!.center).applyMatrix4(src.matrixWorld);
                    } else {
                        world.setFromMatrixPosition(node.matrixWorld);
                    }
                    const d = shotLenForUniforms > 0 ? shotLenForUniforms : origin.distanceTo(world);
                    mat.uniforms.penetration.value =
                        rolledPenetration(near, sh.penetration_far, d, isHE) * penMul;
                });
            };
            apply(primaryArmorScene);
            apply(spacedArmorScene);
            apply(spacedStateScene);
        }

function renderSpacedArmorPass() {
  const primaryArmorScene = getPrimaryArmorScene(), spacedArmorScene = getSpacedArmorScene(), spacedStateScene = getSpacedStateScene()
            if (!spacedArmorScene) return;
            const rt = syncPenetrationRT();
            const srt = ensureSpacedStateRT();
            if (!srt) return;
            syncCloneMatrices(spacedArmorScene);
            syncCloneMatrices(spacedStateScene);
            computeGunClipPlane();
            const gunClipPlane = getGunClipPlane();
            if (gunClipPlane) {
                rcUniforms.rcClipPlane.value.set(
                    gunClipPlane.normal.x, gunClipPlane.normal.y, gunClipPlane.normal.z, gunClipPlane.constant);
                rcUniforms.rcClipEnabled.value = true;
            } else {
                rcUniforms.rcClipEnabled.value = false;
            }
            if (spacedStateScene) {
                getRenderer().autoClear = true;
                getRenderer().setRenderTarget(srt);
                getRenderer().setClearColor(0x000000, 0);
                getRenderer().render(spacedStateScene, getCamera());
            }
            const rtIsFloat = spacedRTFloatCapable();
            const inject = (obj: THREE.Object3D) => { obj.traverse(function(node){
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (mesh.isMesh && mat && mat.uniforms && mat.uniforms.spacedArmorBuffer) {
                    mat.uniforms.spacedArmorBuffer.value = rt.texture;
                    if (mat.uniforms.spacedStateBuffer) mat.uniforms.spacedStateBuffer.value = srt.texture;
                    if (mat.uniforms.spacedSatGuard) mat.uniforms.spacedSatGuard.value = rtIsFloat ? 0 : 1;
                    if (mat.uniforms.spacedArmorDepth && rt.depthTexture) mat.uniforms.spacedArmorDepth.value = rt.depthTexture;
                    if (mat.uniforms.inverseProjectionMatrix) mat.uniforms.inverseProjectionMatrix.value = getCamera().projectionMatrixInverse;
                }
            }); };
            if (primaryArmorScene) inject(primaryArmorScene);
            getRenderer().autoClear = true;
            getRenderer().setRenderTarget(rt);
            getRenderer().setClearColor(0x000000, 0);
            getRenderer().render(spacedArmorScene, getCamera());
            getRenderer().autoClear = false;
            getRenderer().setRenderTarget(null);
            getRenderer().clear(true, true, true);
        }
function updateHeatMaskUniforms(on: boolean) {
  const primaryArmorScene = getPrimaryArmorScene()
            if (!primaryArmorScene) return;
            primaryArmorScene.traverse(function(node) {
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (mesh.isMesh && mat && mat.uniforms && mat.uniforms.heatmapMask) {
                    mat.uniforms.heatmapMask.value = on;
                }
            });
        }

  return { updateHeatMaskUniforms, refreshPenetrationResolution, updatePenetrationDistanceUniforms, renderSpacedArmorPass }
}
