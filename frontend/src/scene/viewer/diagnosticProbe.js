// 诊断探针（#820 Agent A 出仓）：window.__armorRicochet 全量只读诊断面 +
// readArmorPixels 逐像素回读。原 tankViewer.js 闭包内对应块整体平移；
// 契约（方法名/返回形状）保持不变——浏览器门禁与控制台对拍依赖它。
import * as THREE from 'three'
import { PBR_VERT, PBR_FRAG } from './armorShaders.js'
import { simulateContinuation, raycastPackAll, packPoseChanged, RC } from '../armorCollisionPack.js'
import { shellTypeOf, hasGunMask } from './armorPlateModel.js'

/**
 * @param {object} deps composition root 注入的显式接口
 * @param {object} deps.hm 热力图管线 handle（viewer/heatmap.js）
 * @param {object} deps.models { tankModel, armorModel }
 * @param {object} deps.rig 炮塔 rig handle（viewer/turretRig.js）
 * @param {object} deps.jc 判定链 handle（viewer/judgment.js）
 * @param {() => object|null} deps.getRenderer / getCamera / getControls
 * @param {() => object} deps.getTankData / getCurrentConfig / getActiveGunNumber
 * @param {() => object|null} deps.getSelectedShell / getShooterShells
 * @param {() => number|null} deps.getModuleMeshes / getWorldMetersPerUnit
 * @param {() => object} deps.equipmentCoeffs
 * @param {() => boolean} deps.getWorldOverviewMode
 * @param {() => number} deps.getTurretDeg / getGunDeg
 * @param {() => object} deps.getAimSession 瞄准会话诊断（aim input owner）
 * @param {(clientX: number, clientY: number) => 'gun'|'turret'|null} deps.aimPartAt
 * @param {() => { cameraMovedAt: number, frameIntervalMs: number }} deps.getCameraMotion
 * @param {() => { x: number, y: number }|null} deps.getRcLastClick / setRcLastClick
 */
export function createDiagnosticProbe(deps) {
    const {
        hm, models, rig, jc,
        getRenderer, getCamera, getControls,
        getTankData, getCurrentConfig, getActiveGunNumber,
        getSelectedShell, getShooterShells,
        getModuleMeshes, getWorldMetersPerUnit, equipmentCoeffs,
        getWorldOverviewMode, getTurretDeg, getGunDeg, getPenetrationMode, shellPenMul,
        getAimSession, aimPartAt, getCameraMotion,
        getRcLastClick, setRcLastClick,
    } = deps

function readArmorPixels({ x, y, width = 1, height = 1 }) {
            if (!getPenetrationMode() || !hm.getPrimaryArmorScene() || !hm.getRicochetPack()) return null;
            const rect = getRenderer().domElement.getBoundingClientRect();
            const size = getRenderer().getDrawingBufferSize(new THREE.Vector2());
            const left = Math.floor((x - rect.left) * size.x / rect.width);
            const top = Math.floor((y - rect.top) * size.y / rect.height);
            const w = Math.ceil(width * size.x / rect.width), h = Math.ceil(height * size.y / rect.height);
            if (![left, top, w, h].every(Number.isFinite) || w < 1 || h < 1 || left < 0 || top < 0 || left + w > size.x || top + h > size.y) {
                throw new RangeError('ROI must be inside the canvas (CSS client coordinates)');
            }
            if (!getRenderer().extensions.has('EXT_color_buffer_float')) throw new Error('Float readback unavailable');
            const savedTarget = getRenderer().getRenderTarget();
            const savedClear = getRenderer().getClearColor(new THREE.Color()), savedAlpha = getRenderer().getClearAlpha();
            const savedAutoClear = getRenderer().autoClear;
            const target = new THREE.WebGLRenderTarget(size.x, size.y, {
                type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, samples: 0,
                minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
            });
            target.texture.colorSpace = THREE.NoColorSpace;
            const saved = [];
            const identities = [];
            const ids = new Float32Array(w * h * 4), values = new Float32Array(w * h * 4);
            const positions = new Float32Array(w * h * 4), reflections = new Float32Array(w * h * 4);
            const started = performance.now();
            try {
                hm.prepareRicochetFrame();
                hm.updatePenetrationDistanceUniforms();
                hm.renderSpacedArmorPass();
                hm.syncCloneMatrices(hm.getPrimaryArmorScene());
                for (const node of hm.getPrimaryArmorScene().children) {
                    const original = { node, material: node.material, geometry: node.geometry };
                    saved.push(original);
                    if (!node.material.uniforms) continue; // preserve the display depth prepass
                    const src = node.userData._src;
                    const id = identities.length + 1;
                    identities.push({ id, meshName: src.name, plateId: src.userData.armorPlateId,
                        matrixWorld: src.matrixWorld.elements.slice(), penetration: node.material.uniforms.penetration.value,
                        caliber: node.material.uniforms.caliber.value, normalization: node.material.uniforms.normalization.value });
                    node.geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
                    const count = node.geometry.attributes.position.count;
                    node.geometry.setAttribute('debugTriangle', new THREE.BufferAttribute(Float32Array.from({ length: count }, (_, j) => Math.floor(j / 3) + 1), 1));
                    node.material = node.material.clone();
                    node.material.uniforms = { ...original.material.uniforms }; // share textures; probe owns no collision textures
                    node.material.transparent = false;
                    node.material.blending = THREE.NoBlending;
                    node.material.toneMapped = false;
                    node.material.vertexShader = 'attribute float debugTriangle; varying highp float vDebugTriangle;\n' +
                        PBR_VERT.replace('void main() {', 'void main() { vDebugTriangle = debugTriangle;');
                    node.material.uniforms.debugPlate = { value: id };
                    node.material.fragmentShader = `precision highp float;
                        uniform float debugPlate; varying highp float vDebugTriangle;
                        void main() { gl_FragColor = vec4(debugPlate, floor(vDebugTriangle + 0.5), 0.0, 1.0); }`;
                }
                const read = (buffer) => {
                    getRenderer().autoClear = true;
                    getRenderer().setClearColor(0, 0);
                    getRenderer().setRenderTarget(target);
                    getRenderer().render(hm.getPrimaryArmorScene(), getCamera());
                    getRenderer().readRenderTargetPixels(target, left, size.y - top - h, w, h, buffer);
                };
                read(ids); // identity-only: bypass continuation entirely
                for (const { node, material } of saved) {
                    if (!material.uniforms) continue;
                    node.material.fragmentShader = PBR_FRAG.replace('gl_FragColor.a *= opacity;',
                        'gl_FragColor = vec4(gapRicochet ? (rcDiag <= 2.0 ? rcDiag : 0.0) : (!noRicochet && mayRicochet) ? float(contCls) : (ricocheted ? 0.0 : (penChance > 0.0 ? 1.0 : 2.0)), rcDiag, penChance, 1.0);');
                    node.material.needsUpdate = true;
                }
                read(values);
                for (const [expression, buffer] of [['wPosR', positions], ['reflR', reflections]]) {
                    for (const { node, material } of saved) {
                        if (!material.uniforms) continue;
                        node.material.fragmentShader = PBR_FRAG.replace('gl_FragColor.a *= opacity;', `gl_FragColor = vec4(${expression}, 1.0);`);
                        node.material.needsUpdate = true;
                    }
                    read(buffer);
                }
                const pixels = [];
                for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
                    const at = ((h - row - 1) * w + col) * 4;
                    if (!ids[at + 3]) continue;
                    const cpu = window.__armorRicochet.predict(left + col, size.y - top - row - 1);
                    const inputs = identities[ids[at] - 1];
                    const cpuAtGpuInput = cpu && !cpu.skip && values[at + 3] > 0
                        ? simulateContinuation(hm.getRicochetPack(), new THREE.Vector3().fromArray(positions, at),
                            new THREE.Vector3().fromArray(reflections, at), { remIn: inputs.penetration * RC.RICO_REMAIN_MUL,
                                caliber: inputs.caliber, normalizationRad: inputs.normalization, thickMul: hm.rcUniforms.rcThickMul.value,
                                clipPlane: hm.getGunClipPlane() })
                        : null;
                    pixels.push({ x: left + col, y: top + row, id: ids[at], triangleId: ids[at + 1] - 1,
                        gpu: { origin: Array.from(positions.slice(at, at + 3)), direction: Array.from(reflections.slice(at, at + 3)) },
                        covered: values[at + 3] > 0, cls: values[at], rcDiag: values[at + 1], probability: values[at + 2],
                        cpu, cpuAtGpuInput });
                }
                return { coordinateSpace: 'drawing-buffer-top-left', width: size.x, height: size.y,
                    cssRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    cameraMatrix: getCamera().matrixWorld.elements.slice(), projectionMatrix: getCamera().projectionMatrix.elements.slice(),
                    turretDeg: getTurretDeg(), gunDeg: getGunDeg(), gridGeneration: hm.getRicochetGridGeneration(),
                    shell: { ...getSelectedShell() }, equipment: equipmentCoeffs(), identities, pixels,
                    readbackMs: performance.now() - started };
            } finally {
                for (const { node, material, geometry } of saved) {
                    if (node.material !== material) node.material.dispose();
                    if (node.geometry !== geometry) node.geometry.dispose();
                    node.material = material; node.geometry = geometry;
                }
                target.dispose();
                getRenderer().setRenderTarget(savedTarget);
                getRenderer().setClearColor(savedClear, savedAlpha);
                getRenderer().autoClear = savedAutoClear;
            }
        }

const probe = {
            readPixels: readArmorPixels,
            info() {
                return {
                    enabled: hm.rcUniforms.rcEnabled.value,
                    meshCount: hm.getRicochetPack() ? hm.getRicochetPack().meshCount : 0,
                    triTotal: hm.getRicochetPack() ? hm.getRicochetPack().triTotal : 0,
                    grid: hm.getRicochetGrid() ? { dims: hm.getRicochetGrid().dims, cell: hm.getRicochetGrid().cellSize, entries: hm.getRicochetGrid().entryTotal } : null,
                    poseDirty: hm.isRicochetPoseDirty(),
                    gridGeneration: hm.getRicochetGridGeneration(),
                    poseMatchesGrid: !!hm.getRicochetPack() && !packPoseChanged(hm.getRicochetPack(), hm.getRicochetPoseSnapshot()),
                    reason: hm.getRicochetPackReason(),
                    judgments: jc.getJudgmentCount(),
                    // 相机/视图诊断：门禁据此断言 dolly 补偿门控（world 总览——命中/脱靶
                    // 同规则——必须保持原生 50°；静态单车检视才允许补偿）
                    view: {
                        fov: getCamera().fov,
                        near: getCamera().near,
                        worldOverview: getWorldOverviewMode(),
                        cameraDistance: getCamera().position.distanceTo(getControls().target),
                    },
                };
            },
            simulate(bouncePos, reflDir) {
                if (!hm.getRicochetPack() || !getSelectedShell()) return null;
                const sh = getSelectedShell();
                const pen = (sh.penetration || 0) * shellPenMul(sh);
                // 入参容错：控制台/CDP 传普通 {x,y,z}（结构化克隆不带 THREE 类）
                const p = bouncePos.isVector3 ? bouncePos : new THREE.Vector3(bouncePos.x, bouncePos.y, bouncePos.z);
                const d = reflDir.isVector3 ? reflDir : new THREE.Vector3(reflDir.x, reflDir.y, reflDir.z);
                return simulateContinuation(hm.getRicochetPack(), p, d, {
                    remIn: pen * RC.RICO_REMAIN_MUL,
                    caliber: jc.resolveCaliberFor(sh),
                    normalizationRad: (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180,
                    thickMul: equipmentCoeffs().thickMul,
                    clipPlane: hm.getGunClipPlane(),
                });
            },
            // GLSL 侧 uniform 当前值（布局对照用）
            __uniforms() {
                return {
                    triRows: hm.rcUniforms.rcTriRows.value, cellRows: hm.rcUniforms.rcCellRows.value, entryRows: hm.rcUniforms.rcEntryRows.value, entryTotal: hm.rcUniforms.rcEntryTotal.value,
                    gridMin: hm.getRicochetGrid() ? hm.getRicochetGrid().gridMin : null, cell: hm.rcUniforms.rcCell.value,
                    dimsF: hm.rcUniforms.rcGridDimsF.value.toArray(), mode: hm.rcUniforms.rcMode.value, thickMul: hm.rcUniforms.rcThickMul.value,
                    clipEnabled: hm.rcUniforms.rcClipEnabled.value, clipPlane: hm.rcUniforms.rcClipPlane.value.toArray(),
                };
            },
            // CPU 侧逐像素预测类通道（差分测试参照）：RT 像素坐标（左下原点）→
            // 相机射线 → 首命中为主装甲且满足跳弹判据 → 反射 + JS 参考续飞 → cls。
            // skip=true 的像素（首命中非主装甲/不跳弹/无命中）不在比对范围。
            predict(px, py) {
                hm.prepareRicochetFrame();
                hm.updatePenetrationDistanceUniforms();
                if (!hm.getRicochetPack() || !getSelectedShell()) return null;
                if (!hm.rcUniforms.rcEnabled.value) return { skip: true, why: 'continuation-disabled' };
                const c = getRenderer().domElement;
                const w = c.width, h = c.height;
                if (px < 0 || py < 0 || px >= w || py >= h) return { skip: true };
                const ndc = new THREE.Vector2((px + 0.5) / w * 2 - 1, (py + 0.5) / h * 2 - 1);
                const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(getCamera())
                    .sub(getCamera().position).normalize();
                const hits = raycastPackAll(hm.getRicochetPack(), getCamera().position, dir, 0.01);
                const first = hits[0];
                const camHits = hits.slice(0, 4).map(x => ({ s: x.section, th: x.thickness, t: +x.t.toFixed(2), ang: +(Math.acos(Math.min(Math.abs(x.normal.dot(dir)), 1)) * 180 / Math.PI).toFixed(0) }));
                if (!first) return { skip: true, why: 'no-hit', camHits };
                if (!(first.section === 'hull' || first.section === 'turret' || first.section === 'gun')) {
                    return { skip: true, why: 'first-not-primary:' + first.section, camHits };
                }
                const sh = getSelectedShell();
                const { thickMul } = equipmentCoeffs();
                const src = hm.getRicochetPack().meshes[first.meshIdx];
                const primary = hm.getPrimaryArmorScene()?.children.find(n => n.userData._src === src && n.material.uniforms);
                if (!primary) return { skip: true, why: 'no-primary-uniform' };
                const pen = primary.material.uniforms.penetration.value;
                const caliber = jc.resolveCaliberFor(sh);
                const th = first.thickness * thickMul;
                const angle = Math.acos(Math.min(Math.abs(first.normal.dot(dir)), 1));
                const rico = (sh.ricochet != null ? sh.ricochet : 70) * Math.PI / 180;
                const threeCal = caliber > th * 3.0;   // underSpaced=false（首命中即主装甲）
                if (threeCal || angle < rico) return { skip: true, why: threeCal ? 'threeCal' : 'angle<' + (rico * 180 / Math.PI).toFixed(0), angleDeg: +(angle * 180 / Math.PI).toFixed(1), camHits };
                const r = dir.clone().sub(first.normal.clone().multiplyScalar(2 * dir.dot(first.normal))).normalize();
                const sim = simulateContinuation(hm.getRicochetPack(), first.point, r, {
                    remIn: pen * RC.RICO_REMAIN_MUL,
                    caliber,
                    normalizationRad: (sh.normalization != null ? sh.normalization : 0) * Math.PI / 180,
                    thickMul,
                    clipPlane: hm.getGunClipPlane(),
                });
                return {
                    skip: false, cls: sim.cls,
                    penetration: pen, penChance: sim.penChance,
                    ray: { origin: getCamera().position.toArray(), direction: dir.toArray() },
                    continuation: { origin: first.point.toArray(), direction: r.toArray(), normal: first.normal.toArray(), ...sim },
                    detail: {
                        first: { meshName: src.name, plateId: src.userData.armorPlateId, triangleId: first.triangleId, slot: first.slot, section: first.section, thickness: first.thickness, angleDeg: +(angle * 180 / Math.PI).toFixed(1), point: [first.point.x.toFixed(2), first.point.y.toFixed(2), first.point.z.toFixed(2)] },
                        reflect: [r.x.toFixed(3), r.y.toFixed(3), r.z.toFixed(3)],
                        layers: (sim.layers || []).map(l => ({ s: l.section, t: +l.t.toFixed(2), eff: +l.eff.toFixed(0), pen: l.penetrated })),
                    },
                };
            },
            // 诊断：部位判定探针（client 坐标 → 'gun'|'turret'|null）
            __aimPart(clientX, clientY) { return aimPartAt(clientX, clientY); },
            // 诊断：瞄准交互状态（浏览器门禁断言「画布外释放不卡死相机」「双指缩放不被
            // 瞄准吃掉」用；cameraDistance = 相机到轨道中心距离，pinch dolly 的可观测面；
            // session = 指针会话内部态，失败时能直接看出是"会话没开"还是"会话没清"）
            aimingState() {
                return {
                    aiming: getAimSession().aiming,
                    turretDeg: getTurretDeg(), gunDeg: getGunDeg(),
                    controlsEnabled: getControls() ? getControls().enabled : null,
                    cameraDistance: (getControls() && getControls().target)
                        ? +getCamera().position.distanceTo(getControls().target).toFixed(4) : null,
                    // 视图静止度（门禁按像素采样部位前必须等它稳定，见 trackCameraMotion）
                    cameraSettledMs: getCameraMotion().cameraMovedAt ? Math.round(performance.now() - getCameraMotion().cameraMovedAt) : 0,
                    frameIntervalMs: Math.round(getCameraMotion().frameIntervalMs),
                    session: getAimSession().session,
                };
            },
            // 诊断：炮塔/炮管 rig 的实际姿态（门禁验证“模型真的动了”，不只读 UI 角度；
            // 无炮塔车辆的 turret 必须为 null、guns 非空——固定战斗室回归）。
            rigState() {
                const mat = (node) => node ? node.matrix.elements.slice() : null;
                const armorGuns = [];
                const armorOrig = rig.getArmorOrigMatrices();
                if (armorOrig) {
                    for (const node of armorOrig.keys()) {
                        if (/^gun_\d+(?:_state_\d+)?_armor_/.test(node.name || '')) {
                            armorGuns.push({ name: node.name, matrix: mat(node) });
                        }
                    }
                }
                const guns = rig.getGunBarrelNodes().length ? rig.getGunBarrelNodes() : rig.getGunNodesList();
                return {
                    turret: rig.getTurretNode() ? { name: rig.getTurretNode().name, matrix: mat(rig.getTurretNode()) } : null,
                    guns: guns.map(n => ({ name: n.name, matrix: mat(n) })),
                    armorGuns,
                    pivots: {
                        turret: rig.getArmorPivotTurret() ? rig.getArmorPivotTurret().toArray() : null,
                        gun: rig.getArmorPivotGun() ? rig.getArmorPivotGun().toArray() : null,
                    },
                };
            },
            // 诊断：克隆网格 matrix vs matrixWorld（坐标框架核对）
            __clones() {
                if (!hm.getPrimaryArmorScene()) return null;
                const out = [];
                hm.getPrimaryArmorScene().children.forEach(c => {
                    if (out.length >= 4 || c.renderOrder !== 1) return;
                    const m = c.matrix.elements, w = c.matrixWorld.elements;
                    let same = true;
                    for (let i = 0; i < 16; i++) if (Math.abs(m[i] - w[i]) > 1e-6) { same = false; break; }
                    out.push({ name: c.userData._src ? (c.userData._src.name || '?') : '?', same, flag: c.matrixWorldNeedsUpdate });
                });
                return out;
            },
            // 诊断：材质实际编译的着色器源码片段（版本核对）
            __shaderPeek() {
                let m = null;
                if (hm.getPrimaryArmorScene()) hm.getPrimaryArmorScene().traverse(n => { if (!m && n.isMesh && n.renderOrder === 1) m = n.material; });
                if (!m) return null;
                const src = m.fragmentShader || '';
                return {
                    len: src.length,
                    hasDDA: src.includes('网格 DDA 在线推进'),
                    hasBudget: src.includes('budget'),
                    hasEmptyBody: src.includes('完全空体'),
                    hasCls3: src.includes('探针（恒）'),
                    tail: src.slice(-160),
                };
            },
            // 诊断：网格原始数据（页面内 JS DDA 镜像对照用；引用直通，勿序列化）
            __gridDebug() {
                return hm.getRicochetGrid()
                    ? { gridMin: hm.getRicochetGrid().gridMin, dims: hm.getRicochetGrid().dims, cellSize: hm.getRicochetGrid().cellSize,
                        cellsData: hm.getRicochetGrid().cellsData, entriesData: hm.getRicochetGrid().entriesData, worldTrisData: hm.getRicochetGrid().worldTrisData }
                    : null;
            },
            // 诊断：当前判定口径（弹参 + 装备系数）
            shell() {
                const sh = getSelectedShell();
                if (!sh) return null;
                const { penMul, thickMul } = equipmentCoeffs();
                return {
                    type: shellTypeOf(sh), pen: (sh.penetration || 0) * penMul, caliber: jc.resolveCaliberFor(sh),
                    ricoDeg: sh.ricochet != null ? sh.ricochet : 70, normDeg: sh.normalization ?? 0, thickMul,
                    remIn: (sh.penetration || 0) * penMul * RC.RICO_REMAIN_MUL,
                };
            },
            // 诊断：点击链同款求交（含可见性/configHidden 标注）
            __raytrace(px, py) {
                const c = getRenderer().domElement;
                const rect = c.getBoundingClientRect();
                const ndcX = ((px - rect.left) / rect.width) * 2 - 1;
                const ndcY = -((py - rect.top) / rect.height) * 2 + 1;
                const act = getActiveGunNumber();
                const cfg = getCurrentConfig();
                const hasMask = hasGunMask(cfg);
                const activeModules = act == null ? getModuleMeshes() : getModuleMeshes().filter(m => {
                    if (m.userData.gunConfig != null) return m.userData.gunConfig === act;
                    return true;
                }).filter(m => !(m.userData.gunMaskPart && !hasMask));
                const rc = new THREE.Raycaster();
                rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), getCamera());
                const objects = [models.armorModel, ...activeModules];
                const hits = rc.intersectObjects(objects, true);
                return hits.slice(0, 8).map(h => {
                    const sec = h.object.userData.armorSection;
                    return {
                        sec, name: h.object.name || '?', dist: +h.distance.toFixed(3),
                        vis: h.object.visible, hidden: !!h.object.userData.configHidden,
                        parentVis: h.object.parent ? h.object.parent.visible : true,
                        th: h.object.userData.armorThickness,
                    };
                });
            },
            // 最后一次点击的对照：真实点击链结果（DOM 文本）vs CPU 逐像素预测
            probe() {
                if (!getRcLastClick()) return { error: '还没有点击记录：先在装甲上点一下目标位置' };
                const c = getRenderer().domElement;
                const rect = c.getBoundingClientRect();
                const cx = Math.floor((getRcLastClick().x - rect.left) / rect.width * c.width);
                const cy = Math.floor((getRcLastClick().y - rect.top) / rect.height * c.height);
                const infoEl = document.getElementById('traj-info');
                return {
                    canvas: [cx, cy],
                    clickResult: infoEl ? (infoEl.textContent || '').replace(/\s+/g, ' ').slice(0, 400) : '(无 traj-info)',
                    predict: window.__armorRicochet.predict(cx, c.height - 1 - cy),
                    state: window.__armorRicochet.info(),
                };
            },
            // 调试：各打包单元的世界包围盒（定位异常矩阵用）
            units() {
                if (!hm.getRicochetPack()) return null;
                const bb = new THREE.Box3();
                return hm.getRicochetPack().units.map(u => {
                    bb.setFromObject(u.mesh);
                    const mn = bb.min, mx = bb.max;
                    return { name: u.mesh.name || '?', section: u.section,
                        min: [+mn.x.toFixed(2), +mn.y.toFixed(2), +mn.z.toFixed(2)],
                        max: [+mx.x.toFixed(2), +mx.y.toFixed(2), +mx.z.toFixed(2)] };
                });
            },
        };
    // 差分对拍钩子：挂载点与契约保持拆分前一致（window 全局，浏览器门禁消费）
    window.__armorRicochet = probe;
    return probe;
}
