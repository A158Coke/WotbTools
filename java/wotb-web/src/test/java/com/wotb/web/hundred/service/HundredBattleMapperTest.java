package com.wotb.web.hundred.service;

import com.wotb.web.hundred.entity.HundredBattleSubmission;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 百场 DTO 的 admin-only 证据映射契约。 */
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
            // ownership 重构：详情字段 gameAccountIdSnapshot → wotbAccountId（记录的 canonical owner）
            assertThat(detail.wotbAccountId())
                    .as("status %s", status)
                    .isEqualTo(111L);
        }
    }

    @Test
    void manualAdminListUsesApprovedValuesInsteadOfClaimedValues() {
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setWotbAccountId(222L);
        submission.setClaimedAverageDamage(3_800);
        submission.setClaimedBattleCount(100);
        submission.setApprovedAverageDamage(3_814);
        submission.setApprovedBattleCount(103);

        final var adminListItem = mapper.toAdminListItem(submission);

        assertThat(adminListItem.approvedAverageDamage()).isEqualTo(3_814);
        assertThat(adminListItem.approvedBattleCount()).isEqualTo(103L);
        // 列表行同样以 wotbAccountId 暴露 canonical owner（Keycloak 身份不再属于 submission）
        assertThat(adminListItem.wotbAccountId()).isEqualTo(222L);
    }
}
