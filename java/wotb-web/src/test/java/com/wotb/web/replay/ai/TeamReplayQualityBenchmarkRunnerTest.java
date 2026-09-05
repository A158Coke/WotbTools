package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Explicit JUnit entry point for the non-default real-replay benchmark runner. */
@Tag("ai-live")
class TeamReplayQualityBenchmarkRunnerTest {

    @Test
    void runExplicitBenchmark() throws Exception {
        new TeamReplayQualityBenchmarkRunner().runExplicitBenchmark();
    }
}
