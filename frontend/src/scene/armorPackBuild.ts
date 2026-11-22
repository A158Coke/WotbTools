// 碰撞包构建与网格加速结构（自 armorCollisionPack.ts 原样平移）：
// buildPack 三角形打包、位姿快照/矩阵刷新与 buildRicochetGrid DDA 网格。
import * as THREE from 'three';
import type { DataTexture, Mesh, Texture } from 'three';
import { isPrimary } from './penetration.js';
import { RC } from './armorPackConstants.js';
import type {
    ArmorSection, BuildPackResult, CollisionPack, CollisionPackFailure, PackEntry, PackUnit,
    RicochetGrid, BuildRicochetGridResult,
} from './armorPackTypes.js';

const MODULE_SECTIONS = new Set(['chassis', 'gunBarrel']);
const VARIANTS: Partial<Record<ArmorSection, number>> = { chassis: RC.VARIANT_BIT.track, gunBarrel: RC.VARIANT_BIT.gun };

/**
 * 打包碰撞几何。entries: [{ mesh, section('hull'|'turret'|'gun'|'spaced'|'chassis'|'gunBarrel'),
 * thickness(基础厚度), variant('track'|'gun'|null, 模块去重用) }]。
 * 单网格三角形数超过 RC.MAX_TRI_PER_MESH 时按连续三角形段【分块】为多个包单元
 * （同 section/thickness/variant/矩阵）——命中集合与整网格完全一致；履带等多块
 * 同 variant 在判定链里照常去重，与点击链（raycaster 对整网格多命中 + variant 去重）等价。
 * 返回 { ok, reason?, meshCount(=包单元数), triTotal, triRows, triData, metaData, matsData }；
 * ok=false 表示超限/非刚性，调用方必须禁用续飞（fail-closed）。
 */
export function buildPack(entries: readonly PackEntry[]): BuildPackResult {
    const units: PackUnit[] = [];   // 打包单元：{ mesh, section, thickness, variant, triStart, triCount }
    const triChunks: Float32Array[] = [];
    const metaOut: number[] = [];
    let triTotal = 0;
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scale = new THREE.Vector3();
    for (const e of entries) {
        if (!isPrimary(e.section) && e.section !== 'spaced' && !MODULE_SECTIONS.has(e.section)) {
            return { ok: false, reason: 'bad-section:' + e.section };
        }
        // 板厚是判定输入：NaN/负数不是“0mm 板”，是数据坏了 → 整包 fail-closed。
        if (!Number.isFinite(e.thickness) || e.thickness < 0) {
            return { ok: false, reason: 'bad-thickness:' + (e.section || '?') };
        }
        const mesh = e.mesh;
        mesh.updateWorldMatrix(true, false);
        mesh.matrixWorld.decompose(_pos, _quat, _scale);
        // 刚性校验：着色器用 R^T 求逆，非刚性矩阵会让求交失真
        if (Math.abs(_scale.x - 1) > 1e-3 || Math.abs(_scale.y - 1) > 1e-3 || Math.abs(_scale.z - 1) > 1e-3) {
            return { ok: false, reason: 'non-rigid-matrix:' + (mesh.name || '?') };
        }
        const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
        // 装甲 mesh 缺顶点属性是模型/数据损坏，不能静默把它从判定几何里剔除。
        if (!pos) return { ok: false, reason: 'no-position:' + (mesh.name || '?') };
        const idx = mesh.geometry.index;
        const triCountAll = Math.floor((idx ? idx.count : pos.count) / 3);
        if (triCountAll <= 0) continue;

        const secCode = RC.SECTION[e.section];
        const variantBit = VARIANTS[e.section] || 0;
        // 局部 AABB + 三角形顶点（局部坐标原样，无世界烘焙）；按段分块写入包单元
        const chunkCount = Math.ceil(triCountAll / RC.MAX_TRI_PER_MESH);
        const chunkTri = Math.ceil(triCountAll / chunkCount);
        const verts = new Float32Array(triCountAll * 9);
        // 顶点读取必须走抽象访问（getX/getY/getZ）：GLB 属性可能是 interleaved buffer，
        // 直接 pos.array[vi*3] 裸索引在交叉布局下会读到垃圾（包围盒错乱、求交全错）
        for (let t = 0; t < triCountAll; t++) {
            for (let k = 0; k < 3; k++) {
                const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
                verts[t * 9 + k * 3] = pos.getX(vi);
                verts[t * 9 + k * 3 + 1] = pos.getY(vi);
                verts[t * 9 + k * 3 + 2] = pos.getZ(vi);
            }
        }
        for (let c = 0; c < chunkCount; c++) {
            if (units.length >= RC.MAX_MESH) return { ok: false, reason: 'too-many-meshes' };
            const from = c * chunkTri;
            const to = Math.min(from + chunkTri, triCountAll);
            const n = to - from;
            if (n <= 0) break;
            let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let t = from; t < to; t++) {
                for (let k = 0; k < 3; k++) {
                    const x = verts[t * 9 + k * 3], y = verts[t * 9 + k * 3 + 1], z = verts[t * 9 + k * 3 + 2];
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                }
            }
            metaOut.push(minX, minY, minZ, secCode, maxX, maxY, maxZ, triTotal, n, e.thickness, variantBit, 0);
            units.push({ mesh, section: e.section, thickness: e.thickness, variant: variantBit, triStart: triTotal, triCount: n, localFrom: from });
            triChunks.push(verts.subarray(from * 9, to * 9));
            triTotal += n;
        }
    }
    if (!units.length || !triTotal) return { ok: false, reason: 'empty' };

    // 顶点纹理数据：RGBA 每 texel 一顶点（xyz + 0）
    const texels = triTotal * 3;
    const triRows = Math.ceil(texels / RC.TRI_ROW);
    const triData = new Float32Array(triRows * RC.TRI_ROW * 4);
    let w = 0;
    for (const chunk of triChunks) {
        for (let i = 0; i < chunk.length; i += 3) {
            triData[w] = chunk[i]; triData[w + 1] = chunk[i + 1]; triData[w + 2] = chunk[i + 2];
            w += 4;
        }
    }
    const metaData = new Float32Array(metaOut);
    const meshes = units.map(u => u.mesh);
    const matsData = new Float32Array(units.length * 16);
    updatePackMatrices({ meshes, matsData, metaData });
    return { ok: true, units, meshes, meshCount: units.length, triTotal, triRows, triData, metaData, matsData };
}

/** Copy doubles, not Float32 GPU data or mutable Matrix4 references. */
export function snapshotPackPose(pack: CollisionPack): number[][] {
    return pack.meshes.map(mesh => mesh.matrixWorld.elements.slice());
}

/** Caller propagates source matrices before comparing; camera motion is irrelevant. */
export function packPoseChanged(pack: CollisionPack, snapshot: number[][] | null | undefined): boolean {
    return !snapshot || snapshot.length !== pack.meshes.length || pack.meshes.some((mesh, i) =>
        mesh.matrixWorld.elements.some((value, j) => value !== snapshot[i][j]));
}

/**
 * 每帧把 pack.meshes 的当前世界矩阵写入矩阵纹理数据，并计算整车世界包围盒
 * （pack.worldMin/worldMax，供着色器早退 uniform）。tankViewer 渲染循环调用。
 */
export function updatePackMatrices(pack: {
    meshes: Mesh[]
    matsData: Float32Array
    metaData?: Float32Array | null
    worldMin?: [number, number, number] | null
    worldMax?: [number, number, number] | null
    textures?: { matsTex: Texture } | null
} | null | undefined): void {
    if (!pack || !pack.meshes) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const metaData = pack.metaData;
    const withAabb = !!metaData;   // buildPack 内部先于 metaData 落盘调用（只写矩阵）
    const corner = new THREE.Vector3();
    for (let i = 0; i < pack.meshes.length; i++) {
        const m = pack.meshes[i];
        m.updateWorldMatrix(true, false);
        m.matrixWorld.toArray(pack.matsData, i * 16);
        if (!withAabb || !metaData) continue;
        const base = i * 12;
        const lo = [metaData[base], metaData[base + 1], metaData[base + 2]];
        const hi = [metaData[base + 4], metaData[base + 5], metaData[base + 6]];
        for (let c = 0; c < 8; c++) {
            corner.set(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2])
                .applyMatrix4(m.matrixWorld);
            if (corner.x < minX) minX = corner.x; if (corner.x > maxX) maxX = corner.x;
            if (corner.y < minY) minY = corner.y; if (corner.y > maxY) maxY = corner.y;
            if (corner.z < minZ) minZ = corner.z; if (corner.z > maxZ) maxZ = corner.z;
        }
    }
    if (withAabb) {
        pack.worldMin = [minX, minY, minZ];
        pack.worldMax = [maxX, maxY, maxZ];
    }
    if (pack.textures) pack.textures.matsTex.needsUpdate = true;
}


/**
 * 世界系均匀网格加速结构（GPU DDA 求交数据面）。
 * 以各单元【当前 matrixWorld】把三角形变换到世界系：顶点写入 worldTrisData（全局
 * triSlot 与 pack 一致），三角形 AABB 覆盖的每个 cell 追加一条 entry（triSlot +
 * sectionCode + thickness）。炮塔/配置变化时重建（相机移动无需重建）——这就是
 * 着色器只测路径 cell 内三角形（~10² 级）代替全量扫描的结构基础。
 * cell 条目超限时按对半【细化】重试（0.45 → 0.225 → … → coverageFloor，最多 4 次尝试；
 * 细化降低单 cell 条目数），到覆盖下界仍超限 → ok=false（调用方禁用续飞，fail-closed）。
 */
export function buildRicochetGrid(pack: CollisionPack | CollisionPackFailure | null | undefined): BuildRicochetGridResult {
    if (!pack || !pack.ok || !pack.units) return { ok: false, reason: 'no-pack' };
    // 世界系顶点（全局 triSlot 布局）
    const worldVerts = new Float32Array(pack.triTotal * 9);
    const secOf = new Int32Array(pack.triTotal);
    const thOf = new Float32Array(pack.triTotal);
    const v = new THREE.Vector3();
    let nanCount = 0;
    for (let u = 0; u < pack.units.length; u++) {
        const unit = pack.units[u];
        const mesh = unit.mesh;
        mesh.updateWorldMatrix(true, false);
        const mw = mesh.matrixWorld;
        const pos = mesh.geometry.attributes.position;
        const idx = mesh.geometry.index;
        const secCode = RC.SECTION[unit.section];
        for (let t = 0; t < unit.triCount; t++) {
            const lt = unit.localFrom + t;
            const slot = unit.triStart + t;
            secOf[slot] = secCode;
            thOf[slot] = unit.thickness;
            for (let k = 0; k < 3; k++) {
                const vi = idx ? idx.getX(lt * 3 + k) : lt * 3 + k;
                v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(mw);
                if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
                    nanCount++;
                    v.set(0, 0, 0);   // 保持数组有限，包围盒不致 NaN 化
                }
                worldVerts[slot * 9 + k * 3] = v.x;
                worldVerts[slot * 9 + k * 3 + 1] = v.y;
                worldVerts[slot * 9 + k * 3 + 2] = v.z;
            }
        }
    }
    if (nanCount > 0) return { ok: false, reason: 'nan-verts:' + nanCount };
    // 稳健性诊断：包围盒异常膨胀时定位元凶单元（防单个坏矩阵拖垮整个网格）。
    // 阈值 80m：高于一切真实车辆几何（含长炮管整车 ~12m），只拦矩阵腐蚀的天文坐标；
    // 覆盖不变量测试（长几何 60m）不受影响。
    {
        const culprits: string[] = [];
        const bb = new THREE.Box3();
        const sz = new THREE.Vector3();
        for (let u = 0; u < pack.units.length; u++) {
            const unit = pack.units[u];
            bb.setFromObject(unit.mesh);
            if (bb.isEmpty()) continue;
            bb.getSize(sz);
            const diag = sz.length();
            if (diag > 80) culprits.push(`${unit.mesh.name || '?'}(${sz.x.toFixed(1)},${sz.y.toFixed(1)},${sz.z.toFixed(1)})`);
        }
        if (culprits.length) {
            return { ok: false, reason: 'bad-unit:' + culprits.slice(0, 3).join('|') + (culprits.length > 3 ? `+${culprits.length - 3}` : '') };
        }
    }
    // 世界包围盒
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < worldVerts.length; i += 3) {
        const x = worldVerts[i], y = worldVerts[i + 1], z = worldVerts[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return { ok: false, reason: 'empty' };
    const ext = [maxX - minX, maxY - minY, maxZ - minZ];
    // 覆盖不变量（评审 P1）：cellSize 下界 = max(extAxis)/GRID_DIM_MAX —— 该尺寸下任何轴
    // 都不超过 cell 数上限，网格恒覆盖全部几何；后续放细只在该下界之内，被截断的
    // capped 成功路径（GPU 网格 AABB 小于几何 → DDA 永不可达 → 静默紫）不可能再出现。
    const coverageFloor = Math.max(ext[0], ext[1], ext[2]) / RC.GRID_DIM_MAX;
    // 初始 cell 尺寸：目标 0.45m，但不低于覆盖下界（长几何抬高初始值）。注意这与覆盖下界
    // 是两个概念——此前把 GRID_CELL_SIZE 也并入 floor，初始 cell 恰等于 floor →
    // `cellSize/2 < floor` 恒真 → 密度细化重试的 attempt 2..4 成为死代码（评审 P1）。
    let cellSize = Math.max(RC.GRID_CELL_SIZE, coverageFloor);
    let dims: number[] = [0, 0, 0];
    let cells: Map<number, number[]> = new Map();
    for (let attempt = 0; attempt < 4; attempt++) {
        dims = [0, 1, 2].map(a => Math.min(RC.GRID_DIM_MAX, Math.max(1, Math.ceil((ext[a] + 1e-4) / cellSize))));
        const capped = dims.some((d, a) => d === RC.GRID_DIM_MAX && ext[a] / RC.GRID_DIM_MAX > cellSize);
        if (capped) return { ok: false, reason: 'grid-capped' };   // 防御断言：下界保证下不可达
        const total = dims[0] * dims[1] * dims[2];
        cells = new Map<number, number[]>();
        let maxCnt = 0;
        for (let slot = 0; slot < pack.triTotal; slot++) {
            let tx0 = Infinity, ty0 = Infinity, tz0 = Infinity, tx1 = -Infinity, ty1 = -Infinity, tz1 = -Infinity;
            for (let k = 0; k < 3; k++) {
                const x = worldVerts[slot * 9 + k * 3], y = worldVerts[slot * 9 + k * 3 + 1], z = worldVerts[slot * 9 + k * 3 + 2];
                if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
                if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
                if (z < tz0) tz0 = z; if (z > tz1) tz1 = z;
            }
            const cx0 = Math.min(dims[0] - 1, Math.max(0, Math.floor((tx0 - minX) / cellSize)));
            const cx1 = Math.min(dims[0] - 1, Math.max(0, Math.floor((tx1 - minX) / cellSize)));
            const cy0 = Math.min(dims[1] - 1, Math.max(0, Math.floor((ty0 - minY) / cellSize)));
            const cy1 = Math.min(dims[1] - 1, Math.max(0, Math.floor((ty1 - minY) / cellSize)));
            const cz0 = Math.min(dims[2] - 1, Math.max(0, Math.floor((tz0 - minZ) / cellSize)));
            const cz1 = Math.min(dims[2] - 1, Math.max(0, Math.floor((tz1 - minZ) / cellSize)));
            for (let cz = cz0; cz <= cz1; cz++)
                for (let cy = cy0; cy <= cy1; cy++)
                    for (let cx = cx0; cx <= cx1; cx++) {
                        const ci = cx + dims[0] * (cy + dims[1] * cz);
                        let list = cells.get(ci);
                        if (!list) { list = []; cells.set(ci, list); }
                        list.push(slot);
                        if (list.length > maxCnt) maxCnt = list.length;
                    }
        }
        void total;
        if (maxCnt <= RC.MAX_CELL_ENTRIES) {
            // 展平：cellsData（offset,count）+ entriesData（triSlot,section,thickness,0）
            const cellTotal = dims[0] * dims[1] * dims[2];
            const cellsData = new Float32Array(cellTotal * 4);
            const entryLists = [...cells.entries()];
            let entryTotal = 0;
            for (const [, list] of entryLists) entryTotal += list.length;
            const entriesData = new Float32Array(entryTotal * 4);
            let off = 0;
            for (const [ci, list] of entryLists) {
                cellsData[ci * 4] = off;
                cellsData[ci * 4 + 1] = list.length;
                for (let i = 0; i < list.length; i++) {
                    const slot = list[i];
                    entriesData[(off + i) * 4] = slot;
                    entriesData[(off + i) * 4 + 1] = secOf[slot];
                    entriesData[(off + i) * 4 + 2] = thOf[slot];
                }
                off += list.length;
            }
            // 世界顶点纹理数据（RGBA 每 texel 一顶点）
            const triRows = Math.ceil((pack.triTotal * 3) / RC.TRI_ROW);
            const worldTrisData = new Float32Array(triRows * RC.TRI_ROW * 4);
            let w = 0;
            for (let i = 0; i < worldVerts.length; i += 3) {
                worldTrisData[w] = worldVerts[i];
                worldTrisData[w + 1] = worldVerts[i + 1];
                worldTrisData[w + 2] = worldVerts[i + 2];
                w += 4;
            }
            return {
                ok: true, dims, cellSize,
                gridMin: [minX, minY, minZ],
                cellTotal, entryTotal, triRows,
                cellsData, entriesData, worldTrisData,
            };
        }
        // 密度重试：只要还没到覆盖下界就继续对半细化（0.45 → 0.225 → … → coverageFloor，
        // 最多 4 次尝试）；细化到覆盖下界仍过密 → fail-closed（跳弹紫），不允许截断成功
        if (cellSize <= coverageFloor) break;
        cellSize = Math.max(cellSize / 2, coverageFloor);
    }
    return { ok: false, reason: 'grid-too-dense' };
}

/** 网格三张纹理（cell 表 / 条目表 / 世界顶点）。
 * 数据长度必须补齐到 w×h×4：行宽向上取整后纹理需求常大于有效数据，
 * 缓冲不足的 texImage2D 会触发 GL INVALID_OPERATION（1282）→ 纹理不完整 →
 * 采样恒零（条目表全零 → DDA 永不命中 → 跳弹区永久紫——本 bug 的根因）。 */
export function createGridTextures(grid: RicochetGrid): { cellsTex: DataTexture; entriesTex: DataTexture; worldTrisTex: DataTexture } {
    const mk = (data: Float32Array, w: number, h: number): DataTexture => {
        const need = w * h * 4;
        let buf = data;
        if (data.length < need) {
            buf = new Float32Array(need);
            buf.set(data);
        }
        const t = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.FloatType);
        t.minFilter = THREE.NearestFilter;
        t.magFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.needsUpdate = true;
        return t;
    };
    return {
        cellsTex: mk(grid.cellsData, RC.CELL_ROW, Math.ceil(grid.cellTotal / RC.CELL_ROW)),
        entriesTex: mk(grid.entriesData, RC.ENTRY_ROW, Math.ceil(grid.entryTotal / RC.ENTRY_ROW)),
        worldTrisTex: mk(grid.worldTrisData, RC.TRI_ROW, grid.triRows),
    };
}
