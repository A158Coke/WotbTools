import * as THREE from 'three'
import { createScreenSpacePolyline, disposeOverlayObject } from './overlayStroke.js'
import { ANNOTATION_COLORS, cssHex } from './shotResultPalette.js'
import { poseFromYPR } from '../glbRig.js'
import type { EquipmentSpec, PoseTickSample, ReplayShot, TankData, Vec3 } from './viewerContracts.js'

interface MissShotDeps {
  ml: { models: { tankModel: THREE.Object3D; armorModel: THREE.Object3D } }
  QP: { get(name: string): string | null }
  setWorldOverviewMode(on: boolean): void
  showShotError(msg: string): void
  dbgReset(): void
  dbgInfo(id: string, color: string, name: string, text: string): void
  fmt3(x: number, y: number, z: number): string
  getScene(): THREE.Scene
  getCamera(): THREE.Camera
  getControls(): { target: THREE.Vector3; update(): void }
  shotErrorHtml(): string
  eqBadge(eq: EquipmentSpec | null | undefined): string
  setupShotDebug(refresh: ((on: boolean) => void) | null): void
}

interface LoadedShooter {
  sd: TankData | null
  sModel: THREE.Object3D
  breechGunLocal: THREE.Vector3 | null
}

interface MissShotCtx {
  s: ReplayShot
  QP: { get(name: string): string | null }
  currentShot(): boolean
  loadShooterModel(tid: number, opts: { logTag: string; applyPose(sModel: THREE.Object3D): void }): Promise<LoadedShooter | null>
  poseShooterTurretGun(sModel: THREE.Object3D | null, sd: TankData | null, turretYaw: number | null | undefined, launchVelocity: Vec3 | null | undefined, yaw: number, pitch: number, roll: number, gunPitch: number | null, gunYawRel: number, configIdx: number | null | undefined): void
}

export function renderMissShotAnnotation(deps: MissShotDeps, ctx: MissShotCtx): void {
    const { s, currentShot, loadShooterModel, poseShooterTurretGun } = ctx

                        deps.setWorldOverviewMode(true);
                        const sTS2 = s.shooter_tick_samples || [];
                        let sHit2: PoseTickSample | null = null;
                        for (const cand of sTS2) {
                            if (!sHit2 || Math.abs(cand.dt ?? NaN) < Math.abs(sHit2.dt ?? NaN)) sHit2 = cand;
                        }
                        const shooterPos2 = sHit2 ? sHit2.pos : s.shooter_pos;
                        if (!shooterPos2) { deps.showShotError('脱靶弹缺少射手位置（shooter_pos）'); return; }
                        const ba = s.ball_a || null, bb = s.ball_b || null;
                        if (!ba || !bb || !(ba[0] || ba[1] || ba[2])) { deps.showShotError('脱靶弹缺少弹道数据（ball_a/ball_b）'); return; }
                        deps.dbgReset();
                        const mcx = (ba[0] + bb[0]) / 2, mcy = (ba[1] + bb[1]) / 2, mcz = (ba[2] + bb[2]) / 2;
                        deps.ml.models.tankModel.visible = false;
                        deps.ml.models.armorModel.visible = false;
                        const shooterTid2 = parseInt(deps.QP.get('shooter') ?? '', 10);
                        if (shooterTid2 > 0) {
                            loadShooterModel(shooterTid2, {
                                logTag: '[world-miss]',
                                applyPose: function(sModel: THREE.Object3D) {
                                    const sYaw2 = sHit2 ? sHit2.yaw : 0;
                                    sModel.quaternion.copy(poseFromYPR(sYaw2, sHit2?.pitch ?? 0, sHit2 ? sHit2.roll : 0));
                                    sModel.position.set(shooterPos2[0] - mcx, shooterPos2[1] - mcy, shooterPos2[2] - mcz);
                                    window.__shooterFix = new THREE.Vector3(0, 0, 0);
                                },
                            }).then(function(res: LoadedShooter | null) {
                                if (!res || !currentShot()) return;
                                const sd = res.sd, sModel = res.sModel, breechGunLocal2 = res.breechGunLocal;
                                const sYaw2 = sHit2 ? sHit2.yaw : 0;
                                const sgp2 = (s.quality && s.quality.gun_pitch_degraded &&
                                    s.quality.gun_pitch_degraded.indexOf('shooter') >= 0)
                                    ? null : (s.shooter_gun_pitch != null ? s.shooter_gun_pitch : null);
                                const sRel2 = (s.shooter_turret_yaw || 0) - (s.shooter_ang ? s.shooter_ang[0] : 0);
                                poseShooterTurretGun(sModel, sd, s.shooter_turret_yaw, s.launch_velocity, sYaw2,
                                    sHit2?.pitch ?? 0, sHit2 ? sHit2.roll : 0, sgp2, sRel2, s.shooter_config_idx);
                                if (window.__worldAnno) {
                                    const amk2 = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10),
                                        new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.shooterAnchor, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
                                    amk2.position.copy(sModel.position);
                                    amk2.renderOrder = 998;
                                    window.__worldAnno.add(amk2);
                                    deps.dbgInfo('dbg-anchor-shooter', cssHex(ANNOTATION_COLORS.shooterAnchor), '基准点·射手',
                                        deps.fmt3(sModel.position.x + mcx, sModel.position.y + mcy, sModel.position.z + mcz));
                                }
                                try {
                                    if (breechGunLocal2 && window.__worldAnno) {
                                        const gunNodes2: THREE.Object3D[] = [];
                                        sModel.traverse(function(n: THREE.Object3D) {
                                            if (!gunNodes2.length && /^gun_\d+$/.test(n.name || '')) gunNodes2.push(n);
                                        });
                                        const gunNode2 = gunNodes2[0];
                                        if (gunNode2) {
                                            gunNode2.updateMatrixWorld(true);
                                            const bpos = breechGunLocal2.clone().applyMatrix4(gunNode2.matrixWorld);
                                            const bm2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10),
                                                new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.breech, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
                                            bm2.position.copy(bpos);
                                            bm2.renderOrder = 998;
                                            window.__worldAnno.add(bm2);
                                            deps.dbgInfo('dbg-breech', cssHex(ANNOTATION_COLORS.breech), '炮闩',
                                                deps.fmt3(bpos.x + mcx, bpos.y + mcy, bpos.z + mcz));
                                            const dl2 = new THREE.Line(
                                                new THREE.BufferGeometry().setFromPoints([bpos.clone(),
                                                    new THREE.Vector3(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz)]),
                                                new THREE.LineDashedMaterial({
                                                    color: ANNOTATION_COLORS.deviation, transparent: true, opacity: 0.8,
                                                    dashSize: 0.35, gapSize: 0.25, depthTest: false, toneMapped: false }));
                                            dl2.computeLineDistances();
                                            dl2.renderOrder = 996;
                                            window.__worldAnno.add(dl2);
                                        }
                                    }
                                } catch (e) { console.warn('[world-miss] muzzle marker failed:', e); }
                            });
                        }
                        if (window.__worldAnno) {
                            deps.getScene().remove(window.__worldAnno);
                            disposeOverlayObject(window.__worldAnno);
                        }
                        window.__worldImpactMk = null;
                        window.__worldAnno = new THREE.Group();
                        const chordM = Math.sqrt((bb[0]-ba[0])**2 + (bb[1]-ba[1])**2 + (bb[2]-ba[2])**2);
                        const trajLine2 = createScreenSpacePolyline([
                            new THREE.Vector3(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz),
                            new THREE.Vector3(bb[0]-mcx, bb[1]-mcy, bb[2]-mcz),
                        ], {
                            color: ANNOTATION_COLORS.chord,
                            widthPx: 2,
                            haloWidthPx: 4,
                            haloColor: 0x05070a,
                            haloOpacity: 0.5,
                            opacity: 0.95,
                            renderOrder: 997,
                        });
                        if (trajLine2) window.__worldAnno.add(trajLine2);
                        const lpM2 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10),
                            new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.launch, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
                        lpM2.position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz);
                        lpM2.renderOrder = 998;
                        window.__worldAnno.add(lpM2);
                        const lv2 = s.launch_velocity || [0, 0, 0];
                        const spd2 = Math.sqrt(lv2[0]*lv2[0] + lv2[1]*lv2[1] + lv2[2]*lv2[2]);
                        deps.dbgInfo('dbg-launch', cssHex(ANNOTATION_COLORS.launch), '发射点',
                            deps.fmt3(ba[0], ba[1], ba[2]) + ' · ' + spd2.toFixed(0) + ' m/s');
                        if (spd2 > 1) {
                            const dir2 = new THREE.Vector3(lv2[0], lv2[1], lv2[2]).normalize();
                            const vl2 = createScreenSpacePolyline([
                                lpM2.position.clone(),
                                lpM2.position.clone().addScaledVector(dir2, Math.max(chordM * 1.3, 10)),
                            ], {
                                color: ANNOTATION_COLORS.velocity,
                                widthPx: 1.5,
                                haloWidthPx: 3,
                                haloColor: 0x05070a,
                                haloOpacity: 0.45,
                                dashed: true,
                                dashSize: 1.2,
                                gapSize: 0.8,
                                opacity: 0.9,
                                renderOrder: 997,
                            });
                            if (vl2) window.__worldAnno.add(vl2);
                        }
                        const emk2 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10),
                            new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.endpoint, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
                        emk2.position.set(bb[0]-mcx, bb[1]-mcy, bb[2]-mcz);
                        emk2.renderOrder = 998;
                        window.__worldAnno.add(emk2);
                        deps.dbgInfo('dbg-end', cssHex(ANNOTATION_COLORS.endpoint), '落点',
                            deps.fmt3(bb[0], bb[1], bb[2]) + (s.terrain_impact ? ' · 材质' + s.terrain_impact.material : ''));
                        if (s.terrain_impact) {
                            const td = s.terrain_impact.terminal_dir;
                            const tdn = Math.sqrt(td[0]*td[0] + td[1]*td[1] + td[2]*td[2]) || 1;
                            const dirEnd = [
                                bb[0] + td[0]/tdn*8, bb[1] + td[1]/tdn*8, bb[2] + td[2]/tdn*8];
                            const segLn = createScreenSpacePolyline([
                                new THREE.Vector3(bb[0]-mcx, bb[1]-mcy, bb[2]-mcz),
                                new THREE.Vector3(dirEnd[0]-mcx, dirEnd[1]-mcy, dirEnd[2]-mcz),
                            ], {
                                color: ANNOTATION_COLORS.bounce,
                                widthPx: 2,
                                haloWidthPx: 4,
                                haloColor: 0x05070a,
                                haloOpacity: 0.5,
                                opacity: 0.95,
                                renderOrder: 997,
                            });
                            if (segLn) window.__worldAnno.add(segLn);
                            deps.dbgInfo('dbg-ricochet', cssHex(ANNOTATION_COLORS.bounce), '落点出射方向',
                                deps.fmt3(td[0], td[1], td[2]));
                        }
                        deps.getScene().add(window.__worldAnno);
                        const dirT2 = new THREE.Vector3(bb[0]-ba[0], 0, bb[2]-ba[2]);
                        const lenH2 = dirT2.length();
                        if (lenH2 > 1) {
                            dirT2.divideScalar(lenH2);
                            const perp2 = new THREE.Vector3(-dirT2.z, 0, dirT2.x);
                            deps.getCamera().position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz)
                                .addScaledVector(perp2, Math.max(lenH2 * 0.3, 6))
                                .add(new THREE.Vector3(0, Math.max(lenH2 * 0.22, 4), 0));
                        } else {
                            deps.getCamera().position.set(ba[0]-mcx, ba[1]-mcy, ba[2]-mcz).add(new THREE.Vector3(0, 6, 8));
                        }
                        deps.getControls().target.set((ba[0]+bb[0])/2 - mcx, (ba[1]+bb[1])/2 - mcy, (ba[2]+bb[2])/2 - mcz);
                        deps.getControls().update();
                        const st2 = document.getElementById('turret-controls');
                        const flgM = s.hit_flags || 0;
                        if (st2) { st2.innerHTML = deps.shotErrorHtml() + '<div class="ctrl-row"><b>World View — Shot #' + s.index + ' (脱靶)</b></div>' +
                            (function() {
                                const t4 = s.is_author ? '作者' : (s.shooter_team === 'enemy' ? '敌方' : (s.shooter_team === 'ally' ? '我方' : ''));
                                return '<div class="ctrl-row">Shooter: <b style="color:var(--yellow);">' + (s.shooter_name || '—') + '</b>' + (t4 ? ' · ' + t4 : '') + '</div>' +
                                '<div class="ctrl-row" style="font-size:10px;">搭载: 射手 ' + deps.eqBadge(s.shooter_equipment) +
                                (s.target_equipment || s.game_hit_result !== undefined ? ' · 目标 ' + deps.eqBadge(s.target_equipment) : '') + '</div>';
                            })() +
                            '<div class="ctrl-row">DMG 0 · MISS · 弦长 ' + chordM.toFixed(0) + 'm</div>' +
                            (s.terrain_impact ? '<div class="ctrl-row" style="font-size:10px;color:var(--blue);">落点材质类: ' +
                                s.terrain_impact.material + (function() {
                                    const td = s.terrain_impact.terminal_dir;
                                    const ch = [bb[0]-ba[0], bb[1]-ba[1], bb[2]-ba[2]];
                                    const dn = Math.sqrt(td[0]*td[0]+td[1]*td[1]+td[2]*td[2]) || 1;
                                    const cn = Math.sqrt(ch[0]*ch[0]+ch[1]*ch[1]+ch[2]*ch[2]) || 1;
                                    const ang = Math.acos(Math.max(-1, Math.min(1,
                                        (td[0]*ch[0]+td[1]*ch[1]+td[2]*ch[2])/(dn*cn)))) * 180/Math.PI;
                                    return ' · 出射偏角 <b>' + ang.toFixed(1) + '°</b>' + (ang > 2 ? '（弹跳/减速）' : '');
                                })() + '</div>' : '') +
                            '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">' +
                            '<span style="color:' + cssHex(ANNOTATION_COLORS.launch) + ';">●</span> LaunchPoint <span style="color:' + cssHex(ANNOTATION_COLORS.velocity) + ';">┄</span> 速度向量 ' +
                            '<span style="color:' + cssHex(ANNOTATION_COLORS.chord) + ';">—</span> 弹道弦 <span style="color:' + cssHex(ANNOTATION_COLORS.endpoint) + ';">●</span> 落点 ' +
                            '<span style="color:' + cssHex(ANNOTATION_COLORS.bounce) + ';">●</span> 弹跳点 ' +
                            '<span style="color:' + cssHex(ANNOTATION_COLORS.breech) + ';">●</span> 炮闩(发射起点) ' +
                            '<span style="color:' + cssHex(ANNOTATION_COLORS.shooterAnchor) + ';">●</span> 基准点·射手(type10锚)</div>' +
                            '<div class="ctrl-row" style="font-size:10px;color:var(--muted);">flags=' + flgM.toString(16) +
                            ' · shell_id=' + (s.shell_id || '—') +
                            (s.shell_kind ? ' (' + s.shell_kind + ')' : '') +
                            (s.quality && s.quality.shell_from_terrain ? ' · <span style="color:var(--blue);">弹种来自 0x1b 地形广播</span>' : '') +
                            '</div>'; }
                        deps.setupShotDebug(null);
                        window.__debugSetVisible?.(deps.QP.get('debug') === '1');
                        return;
}
