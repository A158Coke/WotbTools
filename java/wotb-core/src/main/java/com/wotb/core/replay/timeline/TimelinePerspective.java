package com.wotb.core.replay.timeline;

/**
 * Timeline 构建视角：个人复盘（recorder = 「你」）或团队复盘（perspectiveTeam）。
 * <p>recorderAccountId 为 null 时个人视角校验失败（TIMELINE_RECORDER_UNRESOLVED）。</p>
 */
public record TimelinePerspective(
        TimelineRequirements type,
        Long recorderAccountId,
        Integer perspectiveTeam
) {
    public static TimelinePerspective personal(final Long recorderAccountId, final Integer perspectiveTeam) {
        return new TimelinePerspective(TimelineRequirements.PERSONAL, recorderAccountId, perspectiveTeam);
    }

    public static TimelinePerspective team(final Integer perspectiveTeam) {
        return new TimelinePerspective(TimelineRequirements.TEAM, null, perspectiveTeam);
    }
}
