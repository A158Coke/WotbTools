import * as THREE from 'three';
import type { Plane, Vector3 } from 'three';
import { RC } from './armorPackConstants.js';
import type {
    CollisionHit, CollisionPack, GridCollisionHit, BuildRicochetGridResult,
} from './armorPackTypes.js';

const _inv = new THREE.Matrix4();

function meshData(pack: CollisionPack & { metaData: Float32Array }, m: number) {
    const u = pack.units[m];
    const base = m * 12;
    return {
        sec: pack.metaData[base + 3],
        localFrom: u.localFrom,
        triCount: u.triCount,
        thickness: u.thickness,
        variant: u.variant,
        aabbMin: [pack.metaData[base], pack.metaData[base + 1], pack.metaData[base + 2]],
        aabbMax: [pack.metaData[base + 4], pack.metaData[base + 5], pack.metaData[base + 6]],
        mesh: pack.meshes[m],
    };
}

export function raycastPackAll(
    pack: CollisionPack,
    ro: Vector3,
    dir: Vector3,
    tMin: number = 0,
    tMax: number = RC.FAR,
    twoSidedSpaced = false,
    clipPlane: Plane | null = null,
): CollisionHit[] {
    const hits: CollisionHit[] = [];
    for (let m = 0; m < pack.meshCount; m++) {
        const md = meshData(pack, m);
        if (md.triCount <= 0) continue;
        const mw = md.mesh.matrixWorld;
        _inv.copy(mw).invert();
        const lro = new THREE.Vector3(ro.x, ro.y, ro.z).applyMatrix4(_inv);
        const lrd = new THREE.Vector3(dir.x, dir.y, dir.z).transformDirection(_inv);
        let tmin = -Infinity, tmax = Infinity;
        let miss = false;
        for (let a = 0; a < 3; a++) {
            const o = a === 0 ? lro.x : a === 1 ? lro.y : lro.z;
            const d = a === 0 ? lrd.x : a === 1 ? lrd.y : lrd.z;
            const lo = md.aabbMin[a], hi = md.aabbMax[a];
            if (Math.abs(d) < 1e-12) {
                if (o < lo || o > hi) { miss = true; break; }
                continue;
            }
            let t1 = (lo - o) / d, t2 = (hi - o) / d;
            if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
        }
        if (miss || !(tmax > tMin && tmin < tMax)) continue;
        const pos = md.mesh.geometry.attributes.position;
        const idx = md.mesh.geometry.index;
        const section = sectionName(md.sec);
        for (let t = 0; t < md.triCount; t++) {
            const lt = md.localFrom + t;
            const vi = [0, 1, 2].map(k => (idx ? idx.getX(lt * 3 + k) : lt * 3 + k));
            const P = vi.map(i2 => new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2)));
            const e1 = P[1].clone().sub(P[0]);
            const e2 = P[2].clone().sub(P[0]);
            const pv = new THREE.Vector3().crossVectors(lrd, e2);
            const det = e1.dot(pv);
            if (Math.abs(det) < 1e-9) continue;
            const invD = 1 / det;
            const tv = lro.clone().sub(P[0]);
            const u = tv.dot(pv) * invD;
            if (u < 0 || u > 1) continue;
            const qv = new THREE.Vector3().crossVectors(tv, e1);
            const v = lrd.dot(qv) * invD;
            if (v < 0 || u + v > 1) continue;
            const tHit = e2.dot(qv) * invD;
            if (tHit <= tMin || tHit >= tMax) continue;
            const n0 = new THREE.Vector3().crossVectors(e1, e2);
            const back = n0.dot(lrd) >= 0;
            if (back && !(twoSidedSpaced && section === 'spaced')) continue;
            if (back) n0.negate();
            const point = lro.clone().addScaledVector(lrd, tHit).applyMatrix4(mw);
            if (isClippedModuleHit(section, point, clipPlane)) continue;
            hits.push({
                t: tHit, meshIdx: m, section, thickness: md.thickness,
                triangleId: pack.units[m].localFrom + t,
                variant: md.variant, slot: pack.units[m].triStart + t,
                point,
                normal: n0.transformDirection(mw),
            });
        }
    }
    hits.sort((x, y) => x.t - y.t);
    return hits;
}

const SECTION_NAME_BY_CODE: Readonly<Record<number, string>> = Object.freeze(Object.fromEntries(
    Object.entries(RC.SECTION).map(([name, code]) => [code, name]),
)) as Readonly<Record<number, string>>;
function sectionName(code: number): string {
    return SECTION_NAME_BY_CODE[code] || '?';
}

/**
 * gun_mask 裁切面之后的炮管不参与判定：视觉上被 clipping plane 裁掉，
 * 点击主判定/续飞、GPU rcContinue、JS 参考与 HE 采样必须同一口径。
 * 只对 gunBarrel 生效；炮盾装甲板（turret/gun primary）不受影响。
 * @param section section 码名
 * @param point 世界系命中点
 * @param clipPlane 世界系 gunClipPlane
 */
export function isClippedModuleHit(section: string, point: Vector3, clipPlane: Plane | null | undefined): boolean {
    return section === 'gunBarrel' && !!clipPlane && clipPlane.distanceToPoint(point) < 0;
}

/**
 * FrontSide 背面判据（与 `raycastPackAll`/GLSL 的绕序背面剔除同义）：世界法线
 * 朝来向时该交点是实体背面。点击主链对间隙甲做双面求交（临时 DoubleSide），收集时
 * 只放行「该板前面未计过」的间隙甲背面——闭合间隙甲正/背面各计一层会重复消耗厚度；
 * 主装甲/外部模块仍只认迎面命中。判定包与 GLSL 路径默认仍按 FrontSide 剔除。
 * @param normal 世界系绕序法线（翻面之前）
 * @param rayDir 世界系射线方向（单位向量）
 */
export function isBackfaceNormal(normal: Vector3, rayDir: Vector3): boolean {
    return normal.dot(rayDir) > 0;
}

export function raycastGridAll(
    grid: BuildRicochetGridResult | null | undefined,
    ro: Vector3,
    dir: Vector3,
    tMin: number = 0,
    tMax: number = RC.FAR,
    twoSidedSpaced = false,
): GridCollisionHit[] | null {
    if (!grid || !grid.ok) return null;
    const { dims, cellSize, gridMin, cellsData, entriesData, worldTrisData } = grid;
    const o = [ro.x, ro.y, ro.z];
    const d = [dir.x, dir.y, dir.z];
    const lo = [gridMin[0], gridMin[1], gridMin[2]];
    const hi = [lo[0] + dims[0] * cellSize, lo[1] + dims[1] * cellSize, lo[2] + dims[2] * cellSize];
    let t0 = tMin, t1 = Math.min(tMax, RC.FAR);
    for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-12) {
            if (o[a] < lo[a] || o[a] > hi[a]) return [];
            continue;
        }
        let ta = (lo[a] - o[a]) / d[a];
        let tb = (hi[a] - o[a]) / d[a];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
    }
    if (!(t1 > t0)) return [];
    const startT = t0 + Math.min(1e-7, (t1 - t0) * 0.5);
    const px = o[0] + d[0] * startT;
    const py = o[1] + d[1] * startT;
    const pz = o[2] + d[2] * startT;
    const cell = (v: number, a: number) => Math.min(dims[a] - 1, Math.max(0, Math.floor((v - lo[a]) / cellSize)));
    let cx = cell(px, 0), cy = cell(py, 1), cz = cell(pz, 2);
    const stepX = d[0] > 0 ? 1 : d[0] < 0 ? -1 : 0;
    const stepY = d[1] > 0 ? 1 : d[1] < 0 ? -1 : 0;
    const stepZ = d[2] > 0 ? 1 : d[2] < 0 ? -1 : 0;
    const inf = Infinity;
    const tDeltaX = stepX ? Math.abs(cellSize / d[0]) : inf;
    const tDeltaY = stepY ? Math.abs(cellSize / d[1]) : inf;
    const tDeltaZ = stepZ ? Math.abs(cellSize / d[2]) : inf;
    let tMaxX = stepX ? (lo[0] + (cx + (stepX > 0 ? 1 : 0)) * cellSize - o[0]) / d[0] : inf;
    let tMaxY = stepY ? (lo[1] + (cy + (stepY > 0 ? 1 : 0)) * cellSize - o[1]) / d[1] : inf;
    let tMaxZ = stepZ ? (lo[2] + (cz + (stepZ > 0 ? 1 : 0)) * cellSize - o[2]) / d[2] : inf;
    const hits: GridCollisionHit[] = [];
    const seen = new Set<number>();
    const maxSteps = dims[0] + dims[1] + dims[2] + 8;
    for (let s = 0; s < maxSteps; s++) {
        const ci = cx + dims[0] * (cy + dims[1] * cz);
        const off = cellsData[ci * 4] | 0;
        const cnt = cellsData[ci * 4 + 1] | 0;
        for (let e = 0; e < cnt; e++) {
            const ei = (off + e) * 4;
            const slot = entriesData[ei] | 0;
            if (seen.has(slot)) continue;
            const b = slot * 12;
            const ax = worldTrisData[b], ay = worldTrisData[b + 1], az = worldTrisData[b + 2];
            const bx = worldTrisData[b + 4], by = worldTrisData[b + 5], bz = worldTrisData[b + 6];
            const cx2 = worldTrisData[b + 8], cy2 = worldTrisData[b + 9], cz2 = worldTrisData[b + 10];
            const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
            const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
            const secCode = entriesData[ei + 1] | 0;
            const nx = e1y * e2z - e1z * e2y;
            const ny = e1z * e2x - e1x * e2z;
            const nz = e1x * e2y - e1y * e2x;
            const back = nx * d[0] + ny * d[1] + nz * d[2] >= 0;
            if (back && !(twoSidedSpaced && sectionName(secCode) === 'spaced')) continue;
            const pvx = d[1] * e2z - d[2] * e2y;
            const pvy = d[2] * e2x - d[0] * e2z;
            const pvz = d[0] * e2y - d[1] * e2x;
            const det = e1x * pvx + e1y * pvy + e1z * pvz;
            if (Math.abs(det) < 1e-9) continue;
            const inv = 1 / det;
            const tvx = o[0] - ax, tvy = o[1] - ay, tvz = o[2] - az;
            const u = (tvx * pvx + tvy * pvy + tvz * pvz) * inv;
            if (u < 0 || u > 1) continue;
            const qvx = tvy * e1z - tvz * e1y;
            const qvy = tvz * e1x - tvx * e1z;
            const qvz = tvx * e1y - tvy * e1x;
            const v = (d[0] * qvx + d[1] * qvy + d[2] * qvz) * inv;
            if (v < 0 || u + v > 1) continue;
            const tHit = (e2x * qvx + e2y * qvy + e2z * qvz) * inv;
            if (tHit <= tMin || tHit > t1) continue;
            seen.add(slot);
            const nLen = Math.hypot(nx, ny, nz);
            const normal = nLen > 1e-12
                ? new THREE.Vector3(nx / nLen, ny / nLen, nz / nLen)
                : new THREE.Vector3(0, 1, 0);
            if (normal.x * d[0] + normal.y * d[1] + normal.z * d[2] > 0) normal.negate();
            hits.push({
                t: tHit,
                section: sectionName(secCode),
                thickness: entriesData[ei + 2],
                variant: null,
                slot,
                normal,
                point: new THREE.Vector3(o[0] + d[0] * tHit, o[1] + d[1] * tHit, o[2] + d[2] * tHit),
            });
        }
        const tExit = Math.min(tMaxX, tMaxY, tMaxZ);
        if (!(tExit <= t1)) break;
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
            if (!stepX) break;
            cx += stepX;
            if (cx < 0 || cx >= dims[0]) break;
            tMaxX += tDeltaX;
        } else if (tMaxY <= tMaxZ) {
            if (!stepY) break;
            cy += stepY;
            if (cy < 0 || cy >= dims[1]) break;
            tMaxY += tDeltaY;
        } else {
            if (!stepZ) break;
            cz += stepZ;
            if (cz < 0 || cz >= dims[2]) break;
            tMaxZ += tDeltaZ;
        }
    }
    hits.sort((x, y) => x.t - y.t);
    return hits;
}

