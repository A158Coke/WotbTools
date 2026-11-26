package com.wotb.ai.review;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("ai-live")
class TeamReplayQualityBenchmarkRunnerTest {

    @Test
    void runExplicitBenchmark() throws Exception {
        new TeamReplayQualityBenchmarkRunner().runExplicitBenchmark();
    }
}
