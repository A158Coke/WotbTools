package com.wotb.ai.review;

import com.wotb.core.replay.timeline.TimelineError;

import java.util.List;

public class AiTimelineUnusableException extends IllegalArgumentException {

    public static final String STABLE_ERROR_CODE = "AI_TIMELINE_UNUSABLE";

    public AiTimelineUnusableException(final List<TimelineError> errors) {
        super(STABLE_ERROR_CODE + (errors == null || errors.isEmpty() ? ""
                : ":" + errors));
    }

    public AiTimelineUnusableException(final String detail) {
        super(STABLE_ERROR_CODE + (detail == null || detail.isBlank() ? "" : ":" + detail));
    }
}
