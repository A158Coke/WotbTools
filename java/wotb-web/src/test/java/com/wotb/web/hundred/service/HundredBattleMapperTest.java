package com.wotb.web.hundred.service;

import com.wotb.web.hundred.entity.HundredBattleSubmission;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 百场 DTO 的 admin-only 证据映射契约。 */
class HundredBattleMapperTest {

    private final HundredBattleMapper mapper = new HundredBattleMapper();

    @Test
    void adminDetailReturnsScreenshotOnlyForPending() {
        for (final String status : List.of(
                "PENDING", "CURRENT", "SUPERSEDED", "REJECTED", "CANCELLED", "DELETED")) {
            final HundredBattleSubmission submission = new HundredBattleSubmission();
            submission.setId(1L);
            submission.setStatus(status);
            submission.setVehicleId(385L);
            submission.setVehicleName("Progetto 65");
            submission.setGameAccountIdSnapshot(111L);
            submission.setNicknameSnapshot("PlayerOne");
            submission.setClaimedAverageDamage(4200);
            submission.setClaimedBattleCount(136);
            submission.setProofScreenshot("data:image/png;base64,AAAA");

            if ("PENDING".equals(status)) {
                assertThat(mapper.toAdminDetail(submission).proofScreenshot())
                        .isEqualTo("data:image/png;base64,AAAA");
            } else {
                assertThat(mapper.toAdminDetail(submission).proofScreenshot())
                        .as("status %s", status)
                        .isNull();
            }
        }
    }
}
