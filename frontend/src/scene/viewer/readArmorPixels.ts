import * as THREE from 'three'
import { PBR_VERT, PBR_FRAG } from './armorShaders.js'
import { simulateContinuation, RC } from '../armorCollisionPack.js'
import type { createHeatmapPipeline } from './heatmap.js'
import type { ShellSpec } from './viewerContracts.js'

export interface ArmorPixelReaderDeps {
    hm: ReturnType<typeof createHeatmapPipeline>
    getRenderer: () => THREE.WebGLRenderer
    getCamera: () => THREE.PerspectiveCamera
    getPenetrationMode: () => boolean
    getTurretDeg: () => number
    getGunDeg: () => number
    getSelectedShell: () => ShellSpec | null
    equipmentCoeffs: () => { penMul: number; thickMul: number }
}

export interface ArmorPixelRoi {
    x: number
    y: number
    width?: number
    height?: number
}

export function createArmorPixelReader(deps: ArmorPixelReaderDeps) {
    const { hm, getRenderer, getCamera, getPenetrationMode, getTurretDeg, getGunDeg, getSelectedShell, equipmentCoeffs } = deps
    return function readArmorPixels({ x, y, width = 1, height = 1 }: ArmorPixelRoi) {
            const primaryScene = hm.getPrimaryArmorScene();
            const pack = hm.getRicochetPack();
            const renderer = getRenderer();
            const camera = getCamera();
            if (!getPenetrationMode() || !primaryScene || !pack) return null;
            const rect = renderer.domElement.getBoundingClientRect();
            const size = renderer.getDrawingBufferSize(new THREE.Vector2());
            const left = Math.floor((x - rect.left) * size.x / rect.width);
            const top = Math.floor((y - rect.top) * size.y / rect.height);
            const w = Math.ceil(width * size.x / rect.width), h = Math.ceil(height * size.y / rect.height);
            if (![left, top, w, h].every(Number.isFinite) || w < 1 || h < 1 || left < 0 || top < 0 || left + w > size.x || top + h > size.y) {
                throw new RangeError('ROI must be inside the canvas (CSS client coordinates)');
            }
            if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Float readback unavailable');
            const savedTarget = renderer.getRenderTarget();
            const savedClear = renderer.getClearColor(new THREE.Color()), savedAlpha = renderer.getClearAlpha();
            const savedAutoClear = renderer.autoClear;
            const target = new THREE.WebGLRenderTarget(size.x, size.y, {
                type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, samples: 0,
                minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
            });
            target.texture.colorSpace = THREE.NoColorSpace;
            const saved: Array<{ node: THREE.Mesh; material: THREE.ShaderMaterial; geometry: THREE.BufferGeometry }> = [];
            const identities: Array<{ id: number; meshName: string; plateId: unknown; matrixWorld: number[]; penetration: number; caliber: number; normalization: number }> = [];
            const ids = new Float32Array(w * h * 4), values = new Float32Array(w * h * 4);
            const positions = new Float32Array(w * h * 4), reflections = new Float32Array(w * h * 4);
            const started = performance.now();
            try {
                hm.prepareRicochetFrame();
                hm.updatePenetrationDistanceUniforms();
                hm.renderSpacedArmorPass();
                hm.syncCloneMatrices(primaryScene);
                for (const child of primaryScene.children) {
                    const node = child as THREE.Mesh;
                    const material = node.material as THREE.ShaderMaterial;
                    const original = { node, material, geometry: node.geometry as THREE.BufferGeometry };
                    saved.push(original);
                    if (!material.uniforms) continue;
                    const src = node.userData._src;
                    const id = identities.length + 1;
                    identities.push({ id, meshName: src.name, plateId: src.userData.armorPlateId,
                        matrixWorld: src.matrixWorld.elements.slice(), penetration: material.uniforms.penetration.value as number,
                        caliber: material.uniforms.caliber.value as number, normalization: material.uniforms.normalization.value as number });
                    node.geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
                    const count = node.geometry.attributes.position.count;
                    node.geometry.setAttribute('debugTriangle', new THREE.BufferAttribute(Float32Array.from({ length: count }, (_, j) => Math.floor(j / 3) + 1), 1));
                    const clone = material.clone();
                    node.material = clone;
                    clone.uniforms = { ...material.uniforms };
                    clone.transparent = false;
                    clone.blending = THREE.NoBlending;
                    clone.toneMapped = false;
                    clone.vertexShader = 'attribute float debugTriangle; varying highp float vDebugTriangle;\n' +
                        PBR_VERT.replace('void main() {', 'void main() { vDebugTriangle = debugTriangle;');
                    clone.uniforms.debugPlate = { value: id };
                    clone.fragmentShader = `precision highp float;
                        uniform float debugPlate; varying highp float vDebugTriangle;
                        void main() { gl_FragColor = vec4(debugPlate, floor(vDebugTriangle + 0.5), 0.0, 1.0); }`;
                }
                const read = (buffer: Float32Array) => {
                    renderer.autoClear = true;
                    renderer.setClearColor(0, 0);
                    renderer.setRenderTarget(target);
                    renderer.render(primaryScene, camera);
                    renderer.readRenderTargetPixels(target, left, size.y - top - h, w, h, buffer);
                };
                read(ids);
                for (const { node, material } of saved) {
                    if (!material.uniforms) continue;
                    const clone = node.material as THREE.ShaderMaterial;
                    clone.fragmentShader = PBR_FRAG.replace('gl_FragColor.a *= opacity;',
                        'gl_FragColor = vec4(gapRicochet ? (rcDiag <= 2.0 ? rcDiag : 0.0) : (!noRicochet && mayRicochet) ? float(contCls) : (ricocheted ? 0.0 : (penChance > 0.0 ? 1.0 : 2.0)), rcDiag, penChance, 1.0);');
                    clone.needsUpdate = true;
                }
                read(values);
                const passes: Array<[string, Float32Array]> = [['wPosR', positions], ['reflR', reflections]];
                for (const [expression, buffer] of passes) {
                    for (const { node, material } of saved) {
                        if (!material.uniforms) continue;
                        const clone = node.material as THREE.ShaderMaterial;
                        clone.fragmentShader = PBR_FRAG.replace('gl_FragColor.a *= opacity;', `gl_FragColor = vec4(${expression}, 1.0);`);
                        clone.needsUpdate = true;
                    }
                    read(buffer);
                }
                const pixels: Array<Record<string, unknown>> = [];
                for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
                    const at = ((h - row - 1) * w + col) * 4;
                    if (!ids[at + 3]) continue;
                    const cpu = window.__armorRicochet
                        ? (window.__armorRicochet.predict(left + col, size.y - top - row - 1) as { skip?: boolean } | null)
                        : null;
                    const inputs = identities[ids[at] - 1];
                    const cpuAtGpuInput = cpu && !cpu.skip && values[at + 3] > 0
                        ? simulateContinuation(pack, new THREE.Vector3().fromArray(positions, at),
                            new THREE.Vector3().fromArray(reflections, at), { remIn: inputs.penetration * RC.RICO_REMAIN_MUL,
                                caliber: inputs.caliber, normalizationRad: inputs.normalization, thickMul: hm.rcUniforms.rcThickMul.value as number,
                                clipPlane: hm.getGunClipPlane() })
                        : null;
                    pixels.push({ x: left + col, y: top + row, id: ids[at], triangleId: ids[at + 1] - 1,
                        gpu: { origin: Array.from(positions.slice(at, at + 3)), direction: Array.from(reflections.slice(at, at + 3)) },
                        covered: values[at + 3] > 0, cls: values[at], rcDiag: values[at + 1], probability: values[at + 2],
                        cpu, cpuAtGpuInput });
                }
                return { coordinateSpace: 'drawing-buffer-top-left', width: size.x, height: size.y,
                    cssRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    cameraMatrix: camera.matrixWorld.elements.slice(), projectionMatrix: camera.projectionMatrix.elements.slice(),
                    turretDeg: getTurretDeg(), gunDeg: getGunDeg(), gridGeneration: hm.getRicochetGridGeneration(),
                    shell: { ...(getSelectedShell() ?? {}) }, equipment: equipmentCoeffs(), identities, pixels,
                    readbackMs: performance.now() - started };
            } finally {
                for (const { node, material, geometry } of saved) {
                    const currentMat = node.material as THREE.Material;
                    if (currentMat !== material) currentMat.dispose();
                    if (node.geometry !== geometry) node.geometry.dispose();
                    node.material = material; node.geometry = geometry;
                }
                target.dispose();
                renderer.setRenderTarget(savedTarget);
                renderer.setClearColor(savedClear, savedAlpha);
                renderer.autoClear = savedAutoClear;
            }
        }

}
