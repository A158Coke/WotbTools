package com.wotb.web.mark3.service;

import com.wotb.web.mark3.entity.Mark3Submission;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/** 管理端截图只在 PENDING 期间可见，终态不暴露私有证据。 */
class Mark3MapperTest {

    private final Mark3Mapper mapper = new Mark3Mapper();

    @Test
    void adminDetailReturnsOneOrTwoScreenshotsOnlyWhilePending() {
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(1L);
        submission.setProofScreenshotFirst("data:image/png;base64,AAAA");
        submission.setProofScreenshotSecond("data:image/jpeg;base64,BBBB");
        submission.setStatus("PENDING");

        assertThat(mapper.toAdminDetail(submission).proofScreenshots())
                .containsExactly("data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB");

        for (final String status : List.of("CURRENT", "REJECTED", "CANCELLED", "DELETED")) {
            submission.setStatus(status);
            assertThat(mapper.toAdminDetail(submission).proofScreenshots()).isEmpty();
        }
    }
    @Test
    void deletedDetailPreservesModerationMetadataWithoutScreenshots() {
        final Mark3Submission submission = new Mark3Submission();
        final OffsetDateTime deletedAt = OffsetDateTime.parse("2026-10-02T12:00:00Z");
        submission.setStatus("DELETED");
        submission.setProofScreenshotFirst("private-proof");
        submission.setDeletedAt(deletedAt);
        submission.setDeletedBy("fixture-admin");
        submission.setDeleteReason("OTHER");
        submission.setDeleteReasonText("Fixture cleanup");

        final var detail = mapper.toAdminDetail(submission);
        assertThat(detail.status()).isEqualTo("DELETED");
        assertThat(detail.deletedAt()).isEqualTo(deletedAt);
        assertThat(detail.deletedBy()).isEqualTo("fixture-admin");
        assertThat(detail.deleteReason()).isEqualTo("OTHER");
        assertThat(detail.deleteReasonText()).isEqualTo("Fixture cleanup");
        assertThat(detail.approvedAt()).isNull();
        assertThat(detail.rejectedAt()).isNull();
        assertThat(detail.cancelledAt()).isNull();
        assertThat(detail.proofScreenshots()).isEmpty();
    }

    @Test
    void topLeaderboardUsesApprovedSnapshotAndNullableVehicleContext() {
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(1L);
        submission.setVehicleId(42L);
        submission.setVehicleName("Fixture tank");
        submission.setClaimedBattleCount(99);
        submission.setClaimedAverageDamage(9999);
        submission.setApprovedBattleCount(36);
        submission.setApprovedAverageDamage(4000);
        submission.setApprovedWinRate(new BigDecimal("75"));

        final var page = mapper.toTopLeaderboardPage(List.of(submission), 10, Map.of(36, 2));
        assertThat(page.vehicleId()).isNull();
        assertThat(page.vehicleName()).isNull();
        assertThat(page.items()).singleElement().satisfies(item -> {
            assertThat(item.rank()).isEqualTo(2);
            assertThat(item.approvedBattleCount()).isEqualTo(36);
            assertThat(item.approvedAverageDamage()).isEqualTo(4000);
            assertThat(item.approvedWinRate()).isEqualByComparingTo("75");
        });
        assertThat(mapper.toTopLeaderboardPage(List.of(), 10, Map.of()).totalPages()).isZero();
    }
}
