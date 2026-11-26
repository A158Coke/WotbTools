import type { ShellKind } from './armorPlateModel.js'
import type { EquipmentSpec, ReplayShot, ShellSpec } from './viewerContracts.js'
import { recordedTargetMatchesShot, resolvePitchCheckboxChecked, resolvePitchDeviceEffective } from '../../replay-local/compute/tankSetup'
import { shellTypeOf, calibratedPenMul, ENHANCED_ARMOR_THICK_MUL } from './armorPlateModel.js'

export interface PitchDeviceBonus {
    up?: number
    down?: number
}

export interface EquipmentStateDeps {
    hmRef: () => { updateHeatmapThickness(): void }
    getCurrentTargetId: () => number | null
    getSelectedShell: () => ShellSpec | null | undefined
    getShooterShells: () => ShellSpec[] | null | undefined
    pitchDeviceBonus: PitchDeviceBonus | null
    pitchDeviceAvailable: boolean
    L: { replayEquipmentAutoTitle: string; pitchDevice: string; [key: string]: string }
}

export interface EquipmentStateHandle {
    shotEquipmentCtx(): { shooter: EquipmentSpec | null; target: EquipmentSpec | null }
    effectiveCalibrated(eq?: EquipmentSpec | null): boolean
    effectiveEnhanced(eq?: EquipmentSpec | null): boolean
    effectivePitchDevice(eq?: EquipmentSpec | null): boolean
    setPitchDeviceBonus(value: PitchDeviceBonus | null | undefined): void
    setPitchDeviceAvailable(value: unknown): void
    shellPenMul(s: ShellSpec | null | undefined): number
    shellOptionText(s: ShellSpec): string
    equipmentCoeffs(): { penMul: number; thickMul: number }
    refreshShellOptionText(): void
    syncEquipmentCheckboxes(s: ReplayShot): void
    eqBadge(eq: EquipmentSpec | null | undefined): string
    equipmentOverride: { calibrated: boolean | null; enhanced: boolean | null; pitch: boolean | null }
    getPitchDeviceBonusValue(): PitchDeviceBonus | null
    getPitchDeviceAvailable(): boolean
}

const SHELL_LABEL: Record<ShellKind, string> = { ap: 'AP', apcr: 'APCR', heat: 'HEAT', he: 'HE' };
function shellLabel(s: ShellSpec | null | undefined): string {
    const kind = shellTypeOf(s)
    return (kind && SHELL_LABEL[kind]) || (s && s.type) || '?'
}

function inputEl(id: string): HTMLInputElement | null {
    return document.getElementById(id) as HTMLInputElement | null
}

function selectEl(id: string): HTMLSelectElement | null {
    return document.getElementById(id) as HTMLSelectElement | null
}

export function createEquipmentState(deps: EquipmentStateDeps): EquipmentStateHandle {
    const { hmRef, getCurrentTargetId, getSelectedShell, getShooterShells,
        pitchDeviceBonus, pitchDeviceAvailable: initialPitchDeviceAvailable, L } = deps

        const equipmentOverride: { calibrated: boolean | null; enhanced: boolean | null; pitch: boolean | null } = { calibrated: null, enhanced: null, pitch: null };
        let pitchDeviceBonusValue: PitchDeviceBonus | null = pitchDeviceBonus;
        let pitchDeviceAvailable = !!initialPitchDeviceAvailable;


function shotEquipmentCtx(): { shooter: EquipmentSpec | null; target: EquipmentSpec | null } {
            const ctx = window.__shotCtx || {};
            const target = recordedTargetMatchesShot(ctx.shot, getCurrentTargetId()) ? (ctx.eqTarget || null) : null;
            return { shooter: ctx.eqShooter || null, target };
        }

function effectiveCalibrated(eq?: EquipmentSpec | null): boolean {
            if (equipmentOverride.calibrated != null) return equipmentOverride.calibrated;
            const data = eq || shotEquipmentCtx().shooter;
            return data ? !!data.calibrated_shells
                : !!(inputEl('eq-calibrated') && inputEl('eq-calibrated')!.checked);
        }

function effectiveEnhanced(eq?: EquipmentSpec | null): boolean {
            if (equipmentOverride.enhanced != null) return equipmentOverride.enhanced;
            const data = eq || shotEquipmentCtx().target;
            return data ? !!data.enhanced_armor
                : !!(inputEl('eq-enhanced') && inputEl('eq-enhanced')!.checked);
        }

function effectivePitchDevice(eq?: EquipmentSpec | null): boolean {
            const data = eq || shotEquipmentCtx().target;
            return resolvePitchDeviceEffective({
                available: pitchDeviceAvailable,
                override: equipmentOverride.pitch,
                recorded: data ? !!data.improved_pitch_limits : null,
                checkboxChecked: !!(inputEl('eq-pitch-device') && inputEl('eq-pitch-device')!.checked),
            });
        }

function setPitchDeviceBonus(value: PitchDeviceBonus | null | undefined): void {
            pitchDeviceBonusValue = value || null;
        }

function setPitchDeviceAvailable(value: unknown): void {
            pitchDeviceAvailable = !!value;
        }

function shellPenMul(s: ShellSpec | null | undefined): number {
            const shellEq = (s?.shooter_equipment ?? null) as EquipmentSpec | null;
            const calOn = effectiveCalibrated(shellEq);
            if (!calOn) return 1.0;
            return calibratedPenMul(shellTypeOf(s));
        }

function shellOptionText(s: ShellSpec): string {
            const pen = Math.round((s.penetration || 0) * shellPenMul(s));
            return `${shellLabel(s)} ${pen}mm / ${s.damage || 0}dmg`;
        }

function equipmentCoeffs(): { penMul: number; thickMul: number } {
            const penMul = shellPenMul(getSelectedShell());
            const enhOn = effectiveEnhanced(null);
            const thickMul = enhOn ? ENHANCED_ARMOR_THICK_MUL : 1.0;
            return { penMul, thickMul };
        }

function refreshShellOptionText(): void {
            const sel = selectEl('shell-select');
            const shells = getShooterShells();
            if (!sel || !shells || !shells.length) return;
            Array.from(sel.options).forEach((opt, i) => {
                const shell = shells[i];
                if (shell) opt.textContent = shellOptionText(shell);
            });
        }

function syncEquipmentCheckboxes(s: ReplayShot): void {
            const cal = inputEl('eq-calibrated');
            const enh = inputEl('eq-enhanced');
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
            const pit = inputEl('eq-pitch-device');
            if (pit) {
                const recorded = recordedTargetMatchesShot(s, getCurrentTargetId()) ? (s.target_equipment || null) : null;
                const checked = resolvePitchCheckboxChecked({ override: equipmentOverride.pitch, recorded: recorded ? !!recorded.improved_pitch_limits : null });
                if (recorded) {
                    pit.checked = checked;
                    pit.disabled = true; pit.title = L.replayEquipmentAutoTitle;
                } else {
                    pit.checked = checked;
                    pit.disabled = false; pit.title = '';
                }
            }
            hmRef().updateHeatmapThickness();
            refreshShellOptionText();
        }

function eqBadge(eq: EquipmentSpec | null | undefined): string {
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
