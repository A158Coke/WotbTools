package com.wotb.core.replay.timeline;

/**
 * BattleTimeline validation 错误码（docs/architecture/battle-timeline.md §4）。
 * <p>只针对真正影响 Timeline / AI 判断可靠性的关键条件；完全 optional 字段缺失不拒绝。</p>
 */
public enum TimelineError {
    TIMELINE_META_INVALID,
    TIMELINE_RESULTS_INVALID,
    TIMELINE_ROSTER_INCOMPLETE,
    TIMELINE_RECORDER_UNRESOLVED,
    TIMELINE_TEAM_UNRESOLVED,
    TIMELINE_CLOCK_UNRESOLVED,
    TIMELINE_STREAM_CORRUPTED,
    TIMELINE_POSITION_COVERAGE_INSUFFICIENT,
    TIMELINE_MAPPING_INSUFFICIENT,
    TIMELINE_MAP_UNRESOLVED
}
