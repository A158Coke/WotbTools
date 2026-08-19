package com.wotb.core.processing;

/** 文件中战斗视角与其他文件的相对关系。 */
public enum ReplayFileRelation {
    PRIMARY_PERSPECTIVE,
    EXACT_DUPLICATE,
    SAME_TEAM_DUPLICATE_PERSPECTIVE,
    INDEPENDENT_PERSPECTIVE,
    INDEPENDENT_BATTLE
}
