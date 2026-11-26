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

export function buildPack(entries: readonly PackEntry[]): BuildPackResult {
    const units: PackUnit[] = [];
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
        if (!Number.isFinite(e.thickness) || e.thickness < 0) {
            return { ok: false, reason: 'bad-thickness:' + (e.section || '?') };
        }
        const mesh = e.mesh;
        mesh.updateWorldMatrix(true, false);
        mesh.matrixWorld.decompose(_pos, _quat, _scale);
        if (Math.abs(_scale.x - 1) > 1e-3 || Math.abs(_scale.y - 1) > 1e-3 || Math.abs(_scale.z - 1) > 1e-3) {
            return { ok: false, reason: 'non-rigid-matrix:' + (mesh.name || '?') };
        }
        const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
        if (!pos) return { ok: false, reason: 'no-position:' + (mesh.name || '?') };
        const idx = mesh.geometry.index;
        const triCountAll = Math.floor((idx ? idx.count : pos.count) / 3);
        if (triCountAll <= 0) continue;

        const secCode = RC.SECTION[e.section];
        const variantBit = VARIANTS[e.section] || 0;
        const chunkCount = Math.ceil(triCountAll / RC.MAX_TRI_PER_MESH);
        const chunkTri = Math.ceil(triCountAll / chunkCount);
        const verts = new Float32Array(triCountAll * 9);
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

export function snapshotPackPose(pack: CollisionPack): number[][] {
    return pack.meshes.map(mesh => mesh.matrixWorld.elements.slice());
}

export function packPoseChanged(pack: CollisionPack, snapshot: number[][] | null | undefined): boolean {
    return !snapshot || snapshot.length !== pack.meshes.length || pack.meshes.some((mesh, i) =>
        mesh.matrixWorld.elements.some((value, j) => value !== snapshot[i][j]));
}

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
    const withAabb = !!metaData;
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


export function buildRicochetGrid(pack: CollisionPack | CollisionPackFailure | null | undefined): BuildRicochetGridResult {
    if (!pack || !pack.ok || !pack.units) return { ok: false, reason: 'no-pack' };
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
                    v.set(0, 0, 0);
                }
                worldVerts[slot * 9 + k * 3] = v.x;
                worldVerts[slot * 9 + k * 3 + 1] = v.y;
                worldVerts[slot * 9 + k * 3 + 2] = v.z;
            }
        }
    }
    if (nanCount > 0) return { ok: false, reason: 'nan-verts:' + nanCount };
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
    const coverageFloor = Math.max(ext[0], ext[1], ext[2]) / RC.GRID_DIM_MAX;
    let cellSize = Math.max(RC.GRID_CELL_SIZE, coverageFloor);
    let dims: number[] = [0, 0, 0];
    let cells: Map<number, number[]> = new Map();
    for (let attempt = 0; attempt < 4; attempt++) {
        dims = [0, 1, 2].map(a => Math.min(RC.GRID_DIM_MAX, Math.max(1, Math.ceil((ext[a] + 1e-4) / cellSize))));
        const capped = dims.some((d, a) => d === RC.GRID_DIM_MAX && ext[a] / RC.GRID_DIM_MAX > cellSize);
        if (capped) return { ok: false, reason: 'grid-capped' };
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
        if (cellSize <= coverageFloor) break;
        cellSize = Math.max(cellSize / 2, coverageFloor);
    }
    return { ok: false, reason: 'grid-too-dense' };
}

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
