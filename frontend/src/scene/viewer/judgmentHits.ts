import * as THREE from 'three'
import { isPrimary, withContactRicochet } from '../penetration.js'
import { resolveSpacedHitMask, spacedDedupKey, firstPhysicalHit } from '../armorMeshTopology.js'
import { isClippedModuleHit, isBackfaceNormal } from '../armorCollisionPack.js'
import type { JudgmentDeps } from './judgment.js'

export interface JudgmentHit {
    section: string
    plateId: number | string
    thickness: number
    point: THREE.Vector3
    normal: THREE.Vector3
    partName: string
    distance: number
    object: THREE.Object3D
    backface: boolean
    contact_normal?: THREE.Vector3
    contact_point?: THREE.Vector3
    contact_thickness?: number
    contact_part_name?: string | null
}

interface HitCandidate {
    entry: JudgmentHit
    spaced: boolean
    backface: boolean
    key: string
}

export function createJudgmentHits(deps: Pick<JudgmentDeps, 'models' | 'hm' | 'getPlateThickness'>) {
  const { models, hm, getPlateThickness } = deps
function isEffectivelyVisible(node: THREE.Object3D): boolean {
            for (let n: THREE.Object3D | null = node; n && n !== models.tankModel && n !== models.armorModel; n = n.parent) {
                if (n.visible === false) return false;
                if (n.userData && n.userData.configHidden) return false;
            }
            return true;
        }

function classifyHit(hit: THREE.Intersection, rayDir: THREE.Vector3 | null = null): JudgmentHit | null {
            if (!isEffectivelyVisible(hit.object)) return null;
            if (hit.object.userData.armorSection === 'deco') return null;
            let section = null, plateId = null, thickness = null;
            if (hit.object.userData.armorSection) {
                section = hit.object.userData.armorSection;
                plateId = hit.object.userData.armorPlateId;
                thickness = hit.object.userData.armorThickness;
            } else {
                let node: THREE.Object3D | null = hit.object;
                while (node) {
                    const m = (node.name || '').match(/(hull|turret|gun)_\w*?_?armor_(\d+)/);
                    if (m) { section = m[1]; plateId = m[2]; break; }
                    node = node.parent;
                }
                if (section && plateId) thickness = getPlateThickness(section, plateId);
            }
            if (section === null || thickness === null || thickness === undefined) return null;
            const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
            const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            normal.applyNormalMatrix(nm).normalize();
            const backface = !!rayDir && isBackfaceNormal(normal, rayDir);
            if (backface) normal.negate();
            let partName;
            if (section === 'chassis') {
                partName = plateId === 'leftTrack' ? 'Track (Left)' : 'Track (Right)';
            } else if (section === 'gunBarrel') {
                partName = 'Gun Barrel';
            } else {
                const disp = hit.object.userData.armorSectionOrig || section;
                partName = `${disp.charAt(0).toUpperCase() + disp.slice(1)} Plate ${plateId}`;
            }
            return { section, plateId, thickness, point: hit.point, normal, partName, distance: hit.distance, object: hit.object, backface };
        }

function intersectArmorDoubleSidedSpaced(objects: THREE.Object3D[], caster: THREE.Raycaster): THREE.Intersection[] {
            const mats = new Set<THREE.Material>();
            if (models.armorModel) {
                models.armorModel.traverse(function(node) {
                    const mesh = node as THREE.Mesh;
                    if (!mesh.isMesh || node.userData.armorSection !== 'spaced') return;
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) for (const mat of mesh.material) mats.add(mat);
                        else mats.add(mesh.material);
                    }
                });
            }
            const saved: Array<[THREE.Material, THREE.Side]> = [];
            for (const m of mats) { saved.push([m, m.side]); m.side = THREE.DoubleSide; }
            try {
                return caster.intersectObjects(objects, true);
            } finally {
                for (const [m, side] of saved) m.side = side;
            }
        }

function collectJudgmentHits(intersects: THREE.Intersection[], rayDir: THREE.Vector3, minDistance = 0): { hits: JudgmentHit[]; firstContact: JudgmentHit | null } {
            const candidates: HitCandidate[] = [];
            for (const hit of intersects) {
                if (minDistance > 0 && hit.distance <= minDistance) continue;
                if (isClippedModuleHit(hit.object.userData.armorSection, hit.point, hm.getGunClipPlane())) continue;
                const entry = classifyHit(hit, rayDir);
                if (!entry) continue;
                const origSection = entry.object?.userData?.armorSectionOrig || entry.section || '';
                candidates.push({
                    entry,
                    spaced: entry.section === 'spaced',
                    backface: !!entry.backface,
                    key: spacedDedupKey(origSection, entry.section, entry.plateId),
                });
            }
            let spanEnd = candidates.length;
            for (let i = 0; i < candidates.length; i++) {
                if (isPrimary(candidates[i].entry.section)) { spanEnd = i + 1; break }
            }
            const keep = resolveSpacedHitMask(candidates, spanEnd);
            const hits: JudgmentHit[] = [];
            for (let i = 0; i < candidates.length; i++) if (keep[i]) hits.push(candidates[i].entry);
            const contact = firstPhysicalHit(candidates);
            const contactEntry = contact < 0 ? null : candidates[contact].entry;
            return { hits: withContactRicochet(hits, contactEntry), firstContact: contactEntry };
        }

  return { isEffectivelyVisible, classifyHit, intersectArmorDoubleSidedSpaced, collectJudgmentHits }
}
