import { resolvePitchCheckboxChecked } from '../../replay-local/compute/tankSetup'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'

function setShell(S: Host, index: number) {
            const sel = document.getElementById('shell-select') as HTMLSelectElement | null;
            const i = Number(index);
            if (!sel || !S.dl.getShooterShells() || !Number.isInteger(i) || i < 0 || i >= S.dl.getShooterShells().length) return false;
            S.QP.set('shell', String(i));
            sel.value = String(i);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

function setEquipmentOverride(S: Host, kind: 'calibrated' | 'enhanced' | 'pitch', value: boolean | null | undefined) {
            if (kind !== 'calibrated' && kind !== 'enhanced' && kind !== 'pitch') return;
            S.eqs.equipmentOverride[kind] = value == null ? null : !!value;
            if (kind === 'pitch') {
                const pit = document.getElementById('eq-pitch-device') as HTMLInputElement | null;
                if (pit) {
                    if (value != null) {
                        pit.checked = !!value;
                    } else {
                        const recorded = S.eqs.shotEquipmentCtx().target;
                        pit.checked = resolvePitchCheckboxChecked({
                            override: null,
                            recorded: recorded ? !!recorded.improved_pitch_limits : null,
                        });
                    }
                }
            } else {
                S.refreshEquipmentEffects();
            }
        }

async function setShooterConfig(S: Host, index: number) {
            if (S.dl.getCurrentShooterId() == null) return false;
            const idx = Number(index);
            if (!Number.isInteger(idx) || idx < 0) return false;
            const hasCurrent = !!(S.dl.getShooterData() && S.dl.getShooterData().tank_id === S.dl.getCurrentShooterId());
            if (hasCurrent && idx >= (S.dl.getShooterData().configs || []).length) return false;
            S.QP.set('scfg', String(idx));
            S.QP.delete('shell');
            if (!hasCurrent) {
                S.dl.setPendingShooterConfig({ tankId: S.dl.getCurrentShooterId(), index: idx });
                return true;
            }
            await S.dl.loadShooter(S.dl.getCurrentShooterId());
            return true;
        }

export function bindTankShell(S: Host) {
  Object.assign(S, {
    setShell: bind(S, setShell),
    setEquipmentOverride: bind(S, setEquipmentOverride),
    setShooterConfig: bind(S, setShooterConfig),
  })
}

export function initTankShell(_S: Host) {

}
