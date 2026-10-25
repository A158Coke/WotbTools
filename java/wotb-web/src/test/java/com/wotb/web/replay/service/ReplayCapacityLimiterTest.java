package com.wotb.web.replay.service;

import com.wotb.web.replay.exception.ReplayBusyException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ReplayCapacityLimiterTest {

    @Test
    void rejectsNestedExecutionWhenCapacityIsOccupied() throws Exception {
        final ReplayCapacityLimiter limiter = new ReplayCapacityLimiter(1);

        final String result = limiter.execute(() -> {
            assertThatThrownBy(() -> limiter.execute(() -> "nested"))
                    .isInstanceOf(ReplayBusyException.class);
            return "outer";
        });

        assertThat(result).isEqualTo("outer");
        assertThat(limiter.execute(() -> "next")).isEqualTo("next");
    }

    @Test
    void releasesCapacityWhenTaskThrows() throws Exception {
        final ReplayCapacityLimiter limiter = new ReplayCapacityLimiter(1);

        assertThatThrownBy(() -> limiter.execute(() -> {
            throw new IllegalStateException("task failed");
        })).isInstanceOf(IllegalStateException.class)
                .hasMessage("task failed");

        assertThat(limiter.execute(() -> "recovered")).isEqualTo("recovered");
    }
}
