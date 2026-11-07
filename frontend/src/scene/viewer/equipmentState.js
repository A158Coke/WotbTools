// 装备判定状态（#820 Agent A 出仓）：校准弹/强化装甲/122 俯仰装置的手动覆盖、
// 回放自动判定与勾选框同步的唯一 owner。原 tankViewer.js 闭包内对应块整体平移。
import { recordedTargetMatchesShot, resolvePitchCheckboxChecked, resolvePitchDeviceEffective } from '../../replay-local/compute/tankSetup'
import { shellTypeOf, calibratedPenMul, ENHANCED_ARMOR_THICK_MUL } from './armorPlateModel.js'

/**
 * @param {object} deps composition root 注入的显式接口
 * @param {object} deps.hm 热力图管线（厚度 uniform 刷新）
 * @param {object} deps.jc 判定链（口径解析）
 * @param {() => boolean} deps.isDestroyed
 * @param {() => number|null} deps.getCurrentTargetId 当前目标车 id
 * @param {() => object|null} deps.getSelectedShell / getShooterShells
 * @param {number|null} deps.pitchDeviceBonus 122 加成初值（宿主 options 注入）
 * @param {boolean} deps.pitchDeviceAvailable 初值（宿主 options 注入）
 * @param {object} deps.L 界面文案
 */
const SHELL_LABEL = { ap: 'AP', apcr: 'APCR', heat: 'HEAT', he: 'HE' };
function shellLabel(s) { return SHELL_LABEL[shellTypeOf(s)] || (s && s.type) || '?'; }

export function createEquipmentState(deps) {
    const { hmRef, jcRef, isDestroyed, getCurrentTargetId, getSelectedShell, getShooterShells,
        pitchDeviceBonus, pitchDeviceAvailable: initialPitchDeviceAvailable, L } = deps

        /** 手动覆盖（装甲页图形开关）：null = 跟随回放真值/旧勾选框。 */
        const equipmentOverride = { calibrated: null, enhanced: null, pitch: null };
        /** 装备 122 的俯仰加成（度，{up,down}）；由宿主从 research/devices.json 注入。 */
        let pitchDeviceBonusValue = pitchDeviceBonus;
        /** 目标/被展示车是否存在 122 槽位；未知/不适用时 fail-closed 不加成。 */
        let pitchDeviceAvailable = !!initialPitchDeviceAvailable;


function shotEquipmentCtx() {
            const ctx = window.__shotCtx || {};
            const target = recordedTargetMatchesShot(ctx.shot, getCurrentTargetId()) ? (ctx.eqTarget || null) : null;
            return { shooter: ctx.eqShooter || null, target };
        }

function effectiveCalibrated(eq) {
            if (equipmentOverride.calibrated != null) return equipmentOverride.calibrated;
            const data = eq || shotEquipmentCtx().shooter;
            return data ? !!data.calibrated_shells
                : !!(document.getElementById('eq-calibrated') && document.getElementById('eq-calibrated').checked);
        }

function effectiveEnhanced(eq) {
            if (equipmentOverride.enhanced != null) return equipmentOverride.enhanced;
            const data = eq || shotEquipmentCtx().target;
            return data ? !!data.enhanced_armor
                : !!(document.getElementById('eq-enhanced') && document.getElementById('eq-enhanced').checked);
        }

function effectivePitchDevice(eq) {
            const data = eq || shotEquipmentCtx().target;
            return resolvePitchDeviceEffective({
                available: pitchDeviceAvailable,
                override: equipmentOverride.pitch,
                recorded: data ? !!data.improved_pitch_limits : null,
                checkboxChecked: !!(document.getElementById('eq-pitch-device') && document.getElementById('eq-pitch-device').checked),
            });
        }

function setPitchDeviceBonus(value) {
            pitchDeviceBonusValue = value || null;
        }

function setPitchDeviceAvailable(value) {
            pitchDeviceAvailable = !!value;
        }

function shellPenMul(s) {
            const calOn = effectiveCalibrated((s && s.shooter_equipment) || null);
            if (!calOn) return 1.0;
            // 未知弹种没有可用的装备口径系数；判定入口会 fail-closed，这里不猜 1.07。
            return calibratedPenMul(shellTypeOf(s));
        }

function shellOptionText(s) {
            const pen = Math.round((s.penetration || 0) * shellPenMul(s));
            return `${shellLabel(s)} ${pen}mm / ${s.damage || 0}dmg`;
        }

function equipmentCoeffs() {
            const penMul = shellPenMul(getSelectedShell());
            const enhOn = effectiveEnhanced(null);
            const thickMul = enhOn ? ENHANCED_ARMOR_THICK_MUL : 1.0;
            return { penMul, thickMul };
        }

function refreshShellOptionText() {
            const sel = document.getElementById('shell-select');
            if (!sel || !getShooterShells() || !getShooterShells().length) return;
            Array.from(sel.options).forEach((opt, i) => {
                if (getShooterShells()[i]) opt.textContent = shellOptionText(getShooterShells()[i]);
            });
        }

function syncEquipmentCheckboxes(s) {
            const cal = document.getElementById('eq-calibrated');
            const enh = document.getElementById('eq-enhanced');
            if (cal) {
                if (s.shooter_equipment) {
                    cal.checked = equipmentOverride.calibrated ?? !!s.shooter_equipment.calibrated_shells;
                    cal.disabled = true; cal.title = L.replayEquipmentAutoTitle;
                } else { cal.disabled = false; cal.title = ''; }
            }
            if (enh) {
                if (s.target_equipment) {
                    enh.checked = equipmentOverride.enhanced ?? !!s.target_equipment.enhanced_armor;
                    enh.disabled = true; enh.title = L.replayEquipmentAutoTitle;
                } else { enh.disabled = false; enh.title = ''; }
            }
            const pit = document.getElementById('eq-pitch-device');
            if (pit) {
                const recorded = recordedTargetMatchesShot(s, getCurrentTargetId()) ? (s.target_equipment || null) : null;
                const checked = resolvePitchCheckboxChecked({ override: equipmentOverride.pitch, recorded: recorded ? !!recorded.improved_pitch_limits : null });
                if (recorded) {
                    pit.checked = checked;
                    pit.disabled = true; pit.title = L.replayEquipmentAutoTitle;
                } else {
                    // 换目标后回放真值不适用：回到手动勾选，且不保留上一辆车的勾选态。
                    pit.checked = checked;
                    pit.disabled = false; pit.title = '';
                }
            }
            hmRef().updateHeatmapThickness();
            refreshShellOptionText();
        }

function eqBadge(eq) {
            if (!eq) return '<span style="color:var(--muted);">配件?</span>';
            const c = eq.calibrated_shells ? '<span style="color:var(--green);">校准弹✓</span>' : '<span style="color:var(--muted);">校准弹✗</span>';
            const e = eq.enhanced_armor ? '<span style="color:var(--green);">强化装甲✓</span>' : '<span style="color:var(--muted);">强化装甲✗</span>';
            const p = eq.improved_pitch_limits ? '<span style="color:var(--green);">' + L.pitchDevice + '✓</span>' : '<span style="color:var(--muted);">' + L.pitchDevice + '✗</span>';
            return c + ' ' + e + ' ' + p;
        }
    return {
        shotEquipmentCtx, effectiveCalibrated, effectiveEnhanced, effectivePitchDevice,
        setPitchDeviceBonus, setPitchDeviceAvailable,
        shellPenMul, shellOptionText, equipmentCoeffs,
        refreshShellOptionText, syncEquipmentCheckboxes, eqBadge,
        equipmentOverride,
        getPitchDeviceBonusValue: () => pitchDeviceBonusValue,
        getPitchDeviceAvailable: () => pitchDeviceAvailable,
    };
}
