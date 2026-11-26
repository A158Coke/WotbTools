package com.wotb.core.replay.timeline;

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
