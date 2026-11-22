// 装甲视图 owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）：厚度取色、装甲筛选行、
// 点击录制与 URL 选项/预设应用。依赖读取统一经宿主对象 S。
import { plateThickness } from '../viewer/armorPlateModel.js'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'
import { byId } from './domById.ts'

function getPlateThickness(S: Host, section: string, plateId: string | number) {
            return plateThickness(S.tankData, S.currentConfig(), section, plateId);
        }

function thicknessToColor(_S: Host, t: number | null | undefined) {
            if (t === null || t === undefined) return 0x666666;
            if (t >= 200) return 0x8B0000;
            if (t >= 100) return 0xFF4500;
            if (t >= 60) return 0xFFA500;
            if (t >= 30) return 0xFFD700;
            return 0x228B22;
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

export function bindTankArmor(S: Host) {
  Object.assign(S, {
    getPlateThickness: bind(S, getPlateThickness),
    thicknessToColor: bind(S, thicknessToColor),
    hookRcClickRecorder: bind(S, hookRcClickRecorder),
    setArmorFilterRowVisible: bind(S, setArmorFilterRowVisible),
  })
}

export function initTankArmor(S: Host) {
// 跳弹续飞共享 uniform（同一对象引用注入每个 penetrationMaterial——单点更新全体生效）。
        // 数据面 = 世界系均匀网格（buildRicochetGrid，炮塔/配置变化时重建；相机移动不重建）；
        // 执行面 = 全分辨率主图逐像素求交（rcMode=1；v5.3 起无低清中转）。
        // 调试信息窗口：坐标等调试文字集中展示在窗口行内（颜色点 = 对应 3D 标记），不再往场景挂 sprite 标签
                                /**
         * 122 是否生效：宿主确认该车有槽位 +（手动/URL 覆盖 > 射击受击方装备真值 > 原生勾选）。
         * 裁决走 tankSetup 的纯函数（与勾选回退态同一份逻辑，单测覆盖）。
         */
                /** 宿主从 research/devices.json 读到 122 的 bonusValues 后注入（避免场景硬编码）。 */
                /** 宿主确认目标车预设暴露 122（或射击真值已装备）后开启；未知时 fail-closed。 */
                                        // 校准弹判定态变化后刷新下拉穿深文本：populateShellSelector 渲染时回放配件
        // 判定（__shotCtx）常未就绪（并行装载竞速），文本停在基础穿深，与判定
        // 实际采用的 ×1.06/×1.07 口径不一致。只更新文本，不动选中项。
                // 镜头切换时把勾选框同步为回放自动判定（数据在场=禁用并标注来源；缺失=恢复手动）
                                                                // 弹种门：仅动能弹（AP/APCR）可跳弹；爆炸弹（HE/HEAT，跳弹角 90°）续飞恒关；
        // 还需网格在位（矩阵未就位的宽限期内跳弹维持紫，网格就位后自动恢复）。
        // rcMode 同步切换（v5.3 全分辨率逐像素：1=启用 0=关闭——低清类通道 pass 已删，
        // 此前由该 pass 设置，删除后曾遗漏导致 rcMode 恒 0 → 续飞全紫）。
                // 调试/差分测试钩子：info() 看 pack 状态；simulate(跳弹点, 反射向) 跑 JS 参考续飞
        // （与 GLSL rcContinue 同常量同语义，入参口径与着色器一致 = 穿深×0.75）。
        // 浏览器门禁/控制台对拍 "GPU 像素类 vs JS 参考类" 用。
        /**
         * 拖动位移 → 炮塔 / 炮管角度（BlitzKit 式左键拖坦克：灵敏度 = 拖满屏宽转 180°、
         * 拖满屏高俯仰 180°——MixerScene/Model.tsx 的 π/bounds 公式；含俯仰/水平射界限制）。
         */
        
        // ===== 瞄准交互（BlitzKit MixerScene 语义；Pointer Events 单一路径，评审 BLOCKER 1/2）=====
        // 按炮管 = yaw+俯仰；按炮塔壳 = 只 yaw；车体/空白 = 相机轨道；短按无拖动 = 点击判定。
        // pointerId 跟踪忽略无关指针；pointer capture 保证画布外拖动/释放也能收到
        // pointerup/pointercancel → controls.enabled 不会卡在 false。
        /** 进入瞄准：禁相机控制 + 捕获指针；起点取当前事件位置（触屏在阈值处 claim，
         *  把已累计的阈值位移吃掉，claim 瞬间不产生角度跳变）。 */
                /** 指针会话的唯一清理点（up / cancel / lostpointercapture 共用）：会话态与
         *  拖动跟踪态一并复位，避免任何一条出口留下半截状态（评审：cleanup 集中完整）。 */
                /** 左键按下位置命中哪个瞄准部位（'gun'|'turret'|null=车体/空白→相机）。 */
                        // 探针：记录最后一次左键点击像素（用户触发问题情形后一条命令取三方对照）。
        // 惰性挂载：闭包顶层 renderer 尚未创建（init 末尾才赋值），animate 首帧再挂。
        S.rcLastClick = null;
        S.rcClickHooked = false;
        // 判定代数计数 owner = judgment 模块（jc.getJudgmentCount()）：浏览器门禁用它区分
        // 「短按判定」与「拖动 = 手势（不判定）」。
        
        // Raw diagnostic readback, never decode IDs/classes from the blended display RGB.
        // Synchronous passes freeze one prepared frame; temporary geometry belongs only to this probe.
                
                // 本查看器替换过的装甲材质才可 dispose；GLTF 原始材质可能跨网格共享，不能动。
        // （replaceArmorMaterial 已出仓 viewer/armorMeshState.js，语义原样）
        // —— 装甲分类过滤（主装甲 / 间隙 / 外部模块，2026-10-28 用户要求）——
        /** 节点在“未被分类过滤”时应有的可见性（配置/动态装甲/炮塔变体等其它规则）。 */
                /** 装甲组成显隐只在装甲厚度视图可用：进入时显示这一行，退出时复位并隐藏。 */
        
                /** 把三个分类开关应用到装甲板与外部模块（炮管/履带）的可见性。 */
        
        // 装甲模型视图样式（collision 按钮与热力图退出共用一份写入，避免各自硬编码漂移）：
        // 碰撞视图=按厚度上色并隐藏视觉车体；普通视图=透明覆盖层并显示视觉车体
        // 装甲厚度视图的点击高亮：选中的装甲板保持不透明 + 轻微自发光，其余部件降透明度
                // 高亮/复位共用的材质状态写入：needsUpdate 触发材质参数整体重评估（program 重选 +
        // 缓存哈希），只有 transparent/depthWrite 这类参与渲染状态的开关真正变化时才置位；
        // opacity 是逐 draw 读取的普通状态，不需要（每次点击全板置 needsUpdate 会让下一帧
        // 对每块装甲材质多做一次参数重评估）。
                        
        // 碰撞（装甲厚度）视图：炮管/履带等外部模块用纯色材质（无贴图），与装甲板同厚度色阶
        /** 厚度视图实心炮管体的 gun_mask 裁剪面同步（材质持有同一 Plane 对象，原地更新）。 */
                                // ===== HE 渐变叠加层（默认视图随点击判定显示，2026-10-30 用户裁定）=====
        // 击穿视图的机械（RT0/RT1/叠加 clone）由 penetrationMode 管理；默认视图下选中
        // HE 且爆点已由点击判定给出时复用同一套机械渲染渐变（材质 heatmapMask=false），
        // 条件消失（换非 HE 弹/进厚度视图/换车）即释放。白色可直穿遮罩只在击穿视图。
                        
                
        /** 交战距离衰减（每帧）：对主图 + spaced clone 逐板计算相机→**板心**距离，
         *  按 0x719740 衰减式刷新 pen uniform（d≤100 或 HE 恒 near；d>100 非 HE 线性至 far，
         *  clamp≥0；HEAT 数据 far==near 天然恒平）。相机旋转/移动即实时更新。
         *  距离取样 = 几何包围球中心经**源网格**当前世界矩阵变换——装甲网格节点原点在
         *  模块枢轴（整块车体/炮塔共点），直接用节点原点是模块级距离而非板级；
         *  源矩阵帧内新鲜（同 syncCloneMatrices 的 updateWorldMatrix 口径）。 */
                
        byId('penetration-btn').addEventListener('click', function() {
            S.penetrationMode = !S.penetrationMode;
            // 与装甲厚度（碰撞）视图互斥：开一个必须关另一个（2026-10-28 用户要求）
            if (S.penetrationMode && S.collisionMode) {
                S.collisionMode = false;
                const cb = byId('collision-btn');
                cb.classList.remove('active');
                cb.setAttribute('aria-pressed', 'false');
                S.cvs.resetArmorFilters();
                S.setArmorFilterRowVisible(false);
                S.cvs.setHighlightedArmorNode(null);
                S.cvs.applyArmorViewStyle(false);
            }
            this.classList.toggle('active', S.penetrationMode);
            this.setAttribute('aria-pressed', String(S.penetrationMode));
            byId('click-info').style.display = 'none';
            S.hm.applyPenetrationMode(S.penetrationMode);
            S.hm.refreshPenetrationResolution();
        });


        // —— 动态装甲（armorsStatesController，全库 6 车，声明见 src/data/armorStates.js）——
        // 状态应用 = 可控板（各态 armors 并集）中非激活板按 **deco 口径**摘除（与穿透判定/
        // 点击分类/跳弹枚举的保留面过滤同源，一处摘除全链生效）；常驻板不受状态控制。
        // 恢复两段式：retag 先按 armorSectionOrig 还原（含 spaced 重判），再对非激活可控板
        // 摘除——顺序不可换。上游 PlaybackShot.target_armor_state 已按弹着时刻预解析状态号，
        // 本层不再持有时间线；换弹/重进复现时经 setArmorState 门控切换。

        /** 换车时解析声明：动态车 → {decl, 初态}；静态车两者置 null（全链 no-op）。 */
        
        /** 设置面板勾选框（#armor-state-opt）：动态车显示「动态装甲」勾选——
         *  勾选 = 非默认态，不勾 = 默认态（初值随当前态）；静态车隐藏并复位。 */
        
        
        /** 切换到声明内的状态号；∉ 声明集的值拒绝（消费方门控的最后防线）。 */
        
        /** 非默认态 id（勾选「动态装甲」对应的态；全部 default 标记时兜底首态）。 */
        
        /** 勾选框与当前态同步（射击复现回放自动判定 = 禁用手动，title 标注来源）。 */
        
        /** 厚度视图缓存的原材质与实心材质：目标卸载后不会再恢复，必须连同贴图释放。 */
        
        // 装甲页图形开关的手动覆盖（&eqcal=0/1、&eqenh=0/1）：场景初始化即生效
        if (S.QP.has('eqcal')) S.eqs.equipmentOverride.calibrated = S.QP.get('eqcal') === '1';
        if (S.QP.has('eqenh')) S.eqs.equipmentOverride.enhanced = S.QP.get('eqenh') === '1';
        // 122 改进型垂直稳定器（装甲页手动 what-if；射击复现由 target_equipment 自动判定）
        if (S.QP.has('eqpitch')) S.eqs.equipmentOverride.pitch = S.QP.get('eqpitch') === '1';
        // 本机复现开关：?armordebug=1（仅 dev）。点击后复制/查看本次判定的完整输入与层链。
        S.ARMOR_DEBUG = import.meta.env.DEV && S.QP.get('armordebug') === '1';
}
