package com.wotb.web.hundred.service;

import com.wotb.web.hundred.entity.HundredBattleSubmission;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class HundredBattleMapperTest {

    private final HundredBattleMapper mapper = new HundredBattleMapper();

    @Test
    void adminDetailReturnsManualScreenshotOnlyForPending() {
        for (final String status : List.of(
                "PENDING", "CURRENT", "SUPERSEDED", "REJECTED", "CANCELLED", "DELETED")) {
            final HundredBattleSubmission submission = new HundredBattleSubmission();
            submission.setId(1L);
            submission.setStatus(status);
            submission.setVehicleId(385L);
            submission.setVehicleName("Progetto 65");
            submission.setWotbServer("CN");
            submission.setWotbAccountId(111L);
            submission.setNicknameSnapshot("PlayerOne");
            submission.setClaimedAverageDamage(4200);
            submission.setClaimedBattleCount(136);
            submission.setProofScreenshot("data:image/png;base64,AAAA");

            final var detail = mapper.toAdminDetail(submission);

            if ("PENDING".equals(status)) {
                assertThat(detail.proofScreenshot())
                        .isEqualTo("data:image/png;base64,AAAA");
            } else {
                assertThat(detail.proofScreenshot())
                        .as("status %s", status)
                        .isNull();
            }
            assertThat(detail.wotbAccountId())
                    .as("status %s", status)
                    .isEqualTo(111L);
            assertThat(detail.wotbServer())
                    .as("status %s", status)
                    .isEqualTo("CN");
        }
    }

    @Test
    void manualAdminListUsesApprovedValuesInsteadOfClaimedValues() {
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setWotbServer("EU");
        submission.setWotbAccountId(222L);
        submission.setClaimedAverageDamage(3_800);
        submission.setClaimedBattleCount(100);
        submission.setApprovedAverageDamage(3_814);
        submission.setApprovedBattleCount(103);

        final var adminListItem = mapper.toAdminListItem(submission);

        assertThat(adminListItem.approvedAverageDamage()).isEqualTo(3_814);
        assertThat(adminListItem.approvedBattleCount()).isEqualTo(103L);
        assertThat(adminListItem.wotbAccountId()).isEqualTo(222L);
        assertThat(adminListItem.wotbServer()).isEqualTo("EU");
    }
}
