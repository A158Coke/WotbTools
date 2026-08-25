package com.wotb.web.hundred.service;

import com.wotb.web.hundred.entity.HundredBattleSubmission;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
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

    @Test
    void wargamingSourceAndOfficialSnapshotReachAdminAndPersonalDtos() {
        final OffsetDateTime verifiedAt = OffsetDateTime.parse("2026-08-23T10:00:00Z");
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setId(7L);
        submission.setStatus("PENDING");
        submission.setVehicleId(385L);
        submission.setVehicleName("Progetto 65");
        submission.setGameAccountIdSnapshot(512_345_678L);
        submission.setNicknameSnapshot("PlayerOne");
        submission.setClaimedAverageDamage(100);
        submission.setClaimedBattleCount(1);
        submission.setVerificationSource("WARGAMING_API");
        submission.setVerifiedAt(verifiedAt);
        submission.setVerifiedServer("ASIA");
        submission.setOfficialAccountBattleCount(5_000L);
        submission.setOfficialTankBattleCount(100L);
        submission.setOfficialTankDamageDealt(390_001L);
        submission.setOfficialAverageDamage(3900);

        final var detail = mapper.toAdminDetail(submission);
        assertThat(detail.verificationSource()).isEqualTo("WARGAMING_API");
        assertThat(detail.verifiedAt()).isEqualTo(verifiedAt);
        assertThat(detail.verifiedServer()).isEqualTo("ASIA");
        assertThat(detail.officialAccountBattleCount()).isEqualTo(5_000L);
        assertThat(detail.officialTankBattleCount()).isEqualTo(100L);
        assertThat(detail.officialTankDamageDealt()).isEqualTo(390_001L);
        assertThat(detail.officialAverageDamage()).isEqualTo(3900);

        final var adminListItem = mapper.toAdminListItem(submission);
        assertThat(adminListItem.verificationSource()).isEqualTo("WARGAMING_API");
        assertThat(adminListItem.certifiedAverageDamage()).isEqualTo(3900);
        assertThat(adminListItem.certifiedBattleCount()).isEqualTo(100L);
        assertThat(mapper.toSummary(submission).verificationSource()).isEqualTo("WARGAMING_API");
        assertThat(mapper.toSummary(submission).officialTankBattleCount()).isEqualTo(100L);
        assertThat(mapper.toSummary(submission).officialAverageDamage()).isEqualTo(3900);
    }

    @Test
    void manualAdminListUsesApprovedValuesInsteadOfClaimedValues() {
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setVerificationSource("MANUAL");
        submission.setClaimedAverageDamage(3_800);
        submission.setClaimedBattleCount(100);
        submission.setApprovedAverageDamage(3_814);
        submission.setApprovedBattleCount(103);

        final var adminListItem = mapper.toAdminListItem(submission);

        assertThat(adminListItem.certifiedAverageDamage()).isEqualTo(3_814);
        assertThat(adminListItem.certifiedBattleCount()).isEqualTo(103L);
    }
}
