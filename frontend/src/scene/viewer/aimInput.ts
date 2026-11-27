import type * as THREE from 'three'
import { pitchAtBearing } from '../../replay-local/compute/tankSetup'
import type { TankConfig, TankData } from './viewerContracts.js'

interface AimInputDeps {
  models: { tankModel?: THREE.Object3D | null; armorModel?: THREE.Object3D | null }
  rig: { updateTurretGun(turretDeg: number, gunDeg: number): void }
  eqs: { effectivePitchDevice(): boolean; getPitchDeviceBonusValue(): { up?: number; down?: number } | null }
  jc: { onClick(e: PointerEvent): void }
  getRenderer(): { domElement: HTMLCanvasElement }
  getCamera(): THREE.Camera
  getControls(): { enabled: boolean } | null
  getRaycaster(): THREE.Raycaster
  getMouse(): THREE.Vector2
  getTankData(): TankData
  getCurrentConfig(): TankConfig | null
  getTurretDeg(): number
  getGunDeg(): number
  setTurretDeg(deg: number): void
  setGunDeg(deg: number): void
}

type AimPart = 'gun' | 'turret'

export interface AimInputHandle {
  aimPointerHandlers: Record<string, (e: PointerEvent) => void>
  aimPartAt(clientX: number, clientY: number): AimPart | null
  aimFromDrag(dxPx: number, dyPx: number): void
  getAimSession(): { aiming: boolean; session: { active: number | null; claimed: boolean; pending: AimPart | null; multiTouch: boolean } }
  isDragging(): boolean
}

export function createAimInput(deps: AimInputDeps): AimInputHandle {
    const {
        models, rig, eqs, jc,
        getRenderer, getCamera, getControls, getRaycaster, getMouse,
        getTankData, getCurrentConfig,
        getTurretDeg, getGunDeg, setTurretDeg, setGunDeg,
    } = deps

        let aimStartX = 0, aimStartY = 0, aimStartTurret = 0, aimStartGun = 0;
        let aiming = false;
        let aimPitchEnabled = true;
        const aimPointerId: { active: number | null } = { active: null };
        let aimClaimed = false;
        let aimPendingPart: AimPart | null = null;
        let mouseDownPos: { x: number; y: number } | null = null, isDragging = false;
        let aimMultiTouch = false;


function aimFromDrag(dxPx: number, dyPx: number): void {
            const rect = getRenderer().domElement.getBoundingClientRect();
            const dx = dxPx * 180 / Math.max(1, rect.width);
            const dy = dyPx * 180 / Math.max(1, rect.height);
            const norm180 = (a: number) => ((a + 180) % 360 + 360) % 360 - 180;
            const yl = getCurrentConfig()?.yaw_limits;
            const pl = getCurrentConfig()?.pitch_limits;
            let yawDeg = aimStartTurret + dx;
            if (yl) {
                if (yl.max - yl.min < 360) {
                    yawDeg = norm180(Math.max(-yl.max, Math.min(-yl.min, yawDeg)));
                } else {
                    yawDeg = norm180(yawDeg);
                }
            } else {
                const tLeft = getTankData().turret_traverse_left ?? 180;
                const tRight = getTankData().turret_traverse_right ?? 180;
                if (!(tLeft >= 180 && tRight >= 180)) {
                    yawDeg = Math.max(-tLeft, Math.min(tRight, yawDeg));
                } else {
                    yawDeg = norm180(yawDeg);
                }
            }
            let pitchDeg = aimStartGun - dy;
            if (pl) {
                const limits = pitchAtBearing(
                    pl,
                    yawDeg,
                    eqs.effectivePitchDevice() ? eqs.getPitchDeviceBonusValue() : null,
                );
                pitchDeg = Math.min(limits.up, Math.max(limits.down, pitchDeg));
            }
            
            setTurretDeg(yawDeg);
            setGunDeg(pitchDeg);
            document.getElementById('turret-val')!.textContent = getTurretDeg().toFixed(0) + '°';
            document.getElementById('gun-val')!.textContent = getGunDeg().toFixed(0) + '°';
            rig.updateTurretGun(getTurretDeg(), getGunDeg());
        }

function claimAim(e: PointerEvent, part: AimPart): void {
            aimClaimed = true;
            aimPendingPart = null;
            aiming = true;
            aimPitchEnabled = part === 'gun';
            aimStartX = e.clientX; aimStartY = e.clientY;
            aimStartTurret = getTurretDeg(); aimStartGun = getGunDeg();
            const controlsOff = getControls();
            if (controlsOff) controlsOff.enabled = false;
            try { getRenderer().domElement.setPointerCapture(e.pointerId); } catch (_) {}
        }

function endPointerSession(e: PointerEvent): void {
            if (aimPointerId.active !== e.pointerId) return;
            aimPointerId.active = null;
            aiming = false;
            aimClaimed = false;
            aimPendingPart = null;
            aimMultiTouch = false;
            mouseDownPos = null;
            isDragging = false;
            const controlsOn = getControls();
            if (controlsOn) controlsOn.enabled = true;
            try {
                if (getRenderer().domElement.hasPointerCapture && getRenderer().domElement.hasPointerCapture(e.pointerId)) {
                    getRenderer().domElement.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}
        }

function aimPartAt(clientX: number, clientY: number): AimPart | null {
            const rect = getRenderer().domElement.getBoundingClientRect();
            getMouse().x = ((clientX - rect.left) / rect.width) * 2 - 1;
            getMouse().y = -((clientY - rect.top) / rect.height) * 2 + 1;
            getRaycaster().setFromCamera(getMouse(), getCamera());
            const objs: THREE.Object3D[] = [];
            if (models.armorModel) objs.push(models.armorModel);
            if (models.tankModel) objs.push(models.tankModel);
            const hits = getRaycaster().intersectObjects(objs, true);
            for (let h = 0; h < hits.length && h < 8; h++) {
                let n: THREE.Object3D | null = hits[h].object;
                let part: AimPart | null = null;
                let chainVisible = true;
                while (n) {
                    if (n.visible === false) { chainVisible = false; break; }
                    const name = n.name || '';
                    if (part === null) {
                        if (/^gun_\d/.test(name)) part = 'gun';
                        else if (/^turret_\d/.test(name)) part = 'turret';
                    }
                    n = n.parent;
                }
                if (chainVisible) return part;
            }
            return null;
        }

const aimPointerHandlers: Record<string, (e: PointerEvent) => void> = {
            down(e: PointerEvent) {
                if (e.button !== 0) return;
                if (aimPointerId.active !== null) {
                    if (e.pointerType === 'touch') {
                        aimMultiTouch = true;
                        aimPendingPart = null;
                    }
                    return;
                }
                aimPointerId.active = e.pointerId;
                aimClaimed = false;
                aimPendingPart = null;
                aimMultiTouch = false;
                mouseDownPos = { x: e.clientX, y: e.clientY };
                isDragging = false;
                if (window.__worldPan) return;
                const part = aimPartAt(e.clientX, e.clientY);
                if (!part) return;
                if (e.pointerType === 'mouse') {
                    claimAim(e, part);
                } else {
                    aimPendingPart = part;
                }
            },
            move(e: PointerEvent) {
                if (aimPointerId.active !== e.pointerId) return;
                if (mouseDownPos) {
                    const dx = e.clientX - mouseDownPos.x;
                    const dy = e.clientY - mouseDownPos.y;
                    if (dx * dx + dy * dy > 25) {
                        isDragging = true;
                        if (aimPendingPart && !aimClaimed && !aimMultiTouch) claimAim(e, aimPendingPart);
                    }
                }
                if (aiming && isDragging) aimFromDrag(e.clientX - aimStartX, aimPitchEnabled ? e.clientY - aimStartY : 0);
            },
            up(e: PointerEvent) {
                if (aimPointerId.active !== e.pointerId) return;
                const wasDragging = isDragging;
                const wasMultiTouch = aimMultiTouch;
                endPointerSession(e);
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                if (wasDragging || wasMultiTouch) return;
                jc.onClick(e);
            },
            cancel: endPointerSession,
            lostCapture(e: PointerEvent) { endPointerSession(e); },
        };
    return {
        aimPointerHandlers, aimPartAt, aimFromDrag,
        getAimSession: () => ({
            aiming,
            session: {
                active: aimPointerId.active,
                claimed: aimClaimed,
                pending: aimPendingPart,
                multiTouch: aimMultiTouch,
            },
        }),
        isDragging: () => isDragging,
    };
}
