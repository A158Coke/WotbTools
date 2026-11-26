import { plateThickness } from '../viewer/armorPlateModel.js'
import { thicknessToColor as thicknessColor } from '../viewer/armorThicknessPalette.js'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'
import { byId } from './domById.ts'

function getPlateThickness(S: Host, section: string, plateId: string | number) {
            return plateThickness(S.tankData, S.currentConfig(), section, plateId);
        }

function thicknessToColor(_S: Host, t: number | null | undefined) {
            return thicknessColor(t);
        }

function hookRcClickRecorder(S: Host) {
            if (S.rcClickHooked || !S.renderer || !S.renderer.domElement) return;
            S.rcClickHooked = true;
            S.renderer.domElement.addEventListener('mouseup', function(e: MouseEvent) {
                if (e.button === 0) S.rcLastClick = { x: e.clientX, y: e.clientY };
            });
        }

function setArmorFilterRowVisible(_S: Host, visible: boolean) {
            const row = document.getElementById('armor-filters');
            if (row) row.hidden = !visible;
        }

function setResultLegendVisible(_S: Host, visible: boolean) {
            const legend = document.getElementById('armor-result-legend');
            if (legend) legend.hidden = !visible;
        }

export function bindTankArmor(S: Host) {
  Object.assign(S, {
    getPlateThickness: bind(S, getPlateThickness),
    thicknessToColor: bind(S, thicknessToColor),
    hookRcClickRecorder: bind(S, hookRcClickRecorder),
    setArmorFilterRowVisible: bind(S, setArmorFilterRowVisible),
    setResultLegendVisible: bind(S, setResultLegendVisible),
  })
}

export function initTankArmor(S: Host) {
        
        S.rcLastClick = null;
        S.rcClickHooked = false;
        
                
        
        
                        
                        
                
                
        byId('penetration-btn').addEventListener('click', function() {
            S.penetrationMode = !S.penetrationMode;
            if (S.penetrationMode && S.collisionMode) {
                S.collisionMode = false;
                const cb = byId('collision-btn');
                cb.classList.remove('active');
                cb.setAttribute('aria-pressed', 'false');
                S.cvs.resetArmorFilters();
                S.setArmorFilterRowVisible(false);
                S.setResultLegendVisible(true);
                S.cvs.setHighlightedArmorNode(null);
                S.cvs.applyArmorViewStyle(false);
            }
            this.classList.toggle('active', S.penetrationMode);
            this.setAttribute('aria-pressed', String(S.penetrationMode));
            byId('click-info').style.display = 'none';
            S.hm.applyPenetrationMode(S.penetrationMode);
            S.hm.refreshPenetrationResolution();
        });



        
        
        
        
        
        
        
        if (S.QP.has('eqcal')) S.eqs.equipmentOverride.calibrated = S.QP.get('eqcal') === '1';
        if (S.QP.has('eqenh')) S.eqs.equipmentOverride.enhanced = S.QP.get('eqenh') === '1';
        if (S.QP.has('eqpitch')) S.eqs.equipmentOverride.pitch = S.QP.get('eqpitch') === '1';
        S.ARMOR_DEBUG = import.meta.env.DEV && S.QP.get('armordebug') === '1';
}
