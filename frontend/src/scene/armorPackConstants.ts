
export const RC = Object.freeze({
    FAR: 60.0,
    MIN_CONTINUATION_T: 0.0001,
    ADVANCE_EPSILON: 0.0001,
    ORIGIN_OFFSET: 0.0,
    RICO_REMAIN_MUL: 0.75,
    MAX_CONTINUATIONS: 1,
    MAX_LAYER: 8,
    MAX_STEPS: 144,
    MAX_CELL_ENTRIES: 256,
    FETCH_BUDGET: 1024,
    TRI_ROW: 768,
    CELL_ROW: 256,
    ENTRY_ROW: 1024,
    GRID_CELL_SIZE: 0.45,
    GRID_DIM_MAX: 48,
    MAX_MESH: 128,
    MAX_TRI_PER_MESH: 256,
    BAND: 0.05,
    COS_EPS: 1e-6,
    TWO_CAL_NORM: 1.4,
    SECTION: Object.freeze({ hull: 0, turret: 1, gun: 2, spaced: 3, chassis: 4, gunBarrel: 5 }),
    VARIANT_BIT: Object.freeze({ track: 1, gun: 2 }),
});

export const RC_DIAG = Object.freeze({ NO_HIT: 0, PENETRATED: 1, BLOCKED: 2, FETCH_BUDGET: 3, LAYER_LIMIT: 4, STEP_LIMIT: 5 });
