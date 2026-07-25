package com.wotb.core.processing;

/** 无法解析队伍视角（训练房/联赛必需）。 */
public class PerspectiveTeamNotResolvedException extends RuntimeException {
    public PerspectiveTeamNotResolvedException(String message) { super(message); }
}
