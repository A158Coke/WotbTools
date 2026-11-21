// 续飞链常量（GLSL 与 JS 参考实现共用；改这里即改两边）——自 armorCollisionPack.ts 原样平移。

/** 续飞链常量（GLSL 与 JS 参考实现共用；改这里即改两边） */
export const RC = Object.freeze({
    /** 续飞参考实现射程 60m。点击链的 Raycaster 未设 far（真实坦克几何 <12m）；
     *  游戏的距离穿深衰减只计算到首次命中点，续飞段沿用剩余穿深，不再按距离衰减。 */
    FAR: 60.0,
    /**
     * 续飞射线【初始命中接受阈】（评审 P1：click / JS 参考 / GLSL 三路唯一语义常量）：
     * 反射线上 t ≤ 该值的命中一律滤除——只是滤数值级自命中（0.1mm），不是"推进步长"。
     * 起点=跳弹点（BlitzKit 对齐，无偏移）；BlitzKit 无过滤但依赖浮点侥幸，这里确定性兜底。
     * 原实现 0.05 偏移 + 0.1m 窗口曾把接缝另一侧板丢弃（接缝点击 bug 根因）。
     * 三路一致口径：click `hit.distance <= RC.MIN_CONTINUATION_T → 滤`、
     * JS `raycastPackAll(..., RC.MIN_CONTINUATION_T)`、GLSL `tStart = max(tStart, RC_TSKIP)`。
     */
    MIN_CONTINUATION_T: 0.0001,
    /**
     * 【层推进 eps】（评审 P1 拆出）：仅用于"已命中一层之后"的推进——下一层必须比
     * 已吞掉的层严格更远（DDA 游标 tCur = bestT + ADV、cell 窗口上界容差），
     * 不得叠加到初始接受阈上（此前 tStart = TSKIP + T_EPS = 0.2mm → 三路阈值不一致）。
     */
    ADVANCE_EPSILON: 0.0001,
    /** 兼容别名（GLSL 定义名不变） */
    ORIGIN_OFFSET: 0.0,
    /** 跳弹剩余穿深系数（penetration.js ricochetRemainingPen = remaining*0.75） */
    RICO_REMAIN_MUL: 0.75,
    /** 首段之后最多再执行的续飞段数：第二次跳弹即为终态，炮弹消失 */
    MAX_CONTINUATIONS: 1,
    /** 层链上限（碰撞模型实际 ≤4/射线；超限按"无续飞"保守处理=维持紫） */
    MAX_LAYER: 8,
    /** DDA 步进上限 = RC_GRID_DIM_MAX×3（144）：cell 交叉上界 = dims.x+dims.y+dims.z ≤ 48×3 */
    MAX_STEPS: 144,
    /** 单 cell 条目上限（构建器超限自动放粗 cell；着色器循环常量上界） */
    MAX_CELL_ENTRIES: 256,
    /** 单片元求交全局纹理取数预算（正常路径 ~300；超预算保守返回紫——防着色器执行超时被驱动杀 draw） */
    FETCH_BUDGET: 1024,
    /** 顶点纹理每行 texel 数（= 256 三角形 × 3 顶点，着色器与打包器共用） */
    TRI_ROW: 768,
    /** cell 纹理每行 texel 数 */
    CELL_ROW: 256,
    /** 条目纹理每行 texel 数 */
    ENTRY_ROW: 1024,
    /** 网格目标 cell 尺寸（米；重建时超限自动 ×2 放粗） */
    GRID_CELL_SIZE: 0.45,
    /** 网格各轴 cell 数上限（纹理行数与步进常量的约束） */
    GRID_DIM_MAX: 48,
    MAX_MESH: 128,
    MAX_TRI_PER_MESH: 256,
    /** Armor Inspector 正态 CDF：±5% 随机化范围 = ±3σ；区间两端平移，σ 不重算 */
    BAND: 0.05,
    /** 90° 防 f32 负 cos 下限（penetration.js 同值） */
    COS_EPS: 1e-6,
    /** 2×口径增强转正系数（BlitzKit/penetration.js 同源） */
    TWO_CAL_NORM: 1.4,
    /** 装甲 section 码（texel0.w；primary = 码≤2，外部模块 = 码≥4） */
    SECTION: Object.freeze({ hull: 0, turret: 1, gun: 2, spaced: 3, chassis: 4, gunBarrel: 5 }),
    /** 外部模块 variant 去重位（texel2.z） */
    VARIANT_BIT: Object.freeze({ track: 1, gun: 2 }),
});

/** Stable raw diagnostic codes; class 0 alone must not hide budget exhaustion. */
export const RC_DIAG = Object.freeze({ NO_HIT: 0, PENETRATED: 1, BLOCKED: 2, FETCH_BUDGET: 3, LAYER_LIMIT: 4, STEP_LIMIT: 5 });
