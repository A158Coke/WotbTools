package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.user.api.WotbAccountIdentity;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HundredLeaderboardTest extends HundredSubmissionTestSupport {

    @Test
    void userStatusQueriesByBoundWotbAccountId() {
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));
        final HundredBattleSubmission current = currentSubmission(4200);
        final HundredBattleSubmission pending = pendingSubmission();
        final HundredBattleSubmission rejected = pendingSubmission();
        rejected.setStatus("REJECTED");
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("CURRENT"))).thenReturn(List.of(current));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("PENDING"))).thenReturn(List.of(pending));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("REJECTED"))).thenReturn(List.of(rejected));

        final var status = service.userStatus(USER);

        assertThat(status.current()).extracting("status").containsExactly("CURRENT");
        assertThat(status.pending()).extracting("status").containsExactly("PENDING");
        assertThat(status.rejected()).extracting("status").containsExactly("REJECTED");
    }

    @Test
    void userStatusQueriesByBoundServerNotOnlyByAccountId() {
        final HundredBattleSubmission euCurrent = currentSubmission(4200);
        euCurrent.setWotbServer(OTHER_SERVER);
        when(userProfileService.currentWotbIdentity(USER))
                .thenReturn(Optional.of(new WotbAccountIdentity(OTHER_SERVER, GAME_ID)));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("CURRENT"))).thenReturn(List.of(euCurrent));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("PENDING"))).thenReturn(List.of());
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("REJECTED"))).thenReturn(List.of());

        final var status = service.userStatus(USER);

        assertThat(status.current()).extracting("status").containsExactly("CURRENT");
        assertThat(status.pending()).isEmpty();
        assertThat(status.rejected()).isEmpty();
        verify(repository, never()).findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                eq(WOTB_SERVER), anyLong(), any());
    }


    @Test
    void leaderboardComputesCompetitionRanking() {
        final HundredBattleSubmission s4300 = currentSubmission(4300);
        s4300.setId(1L);
        final HundredBattleSubmission s4200a = currentSubmission(4200);
        s4200a.setId(2L);
        final HundredBattleSubmission s4200b = currentSubmission(4200);
        s4200b.setId(3L);
        final HundredBattleSubmission s4100 = currentSubmission(4100);
        s4100.setId(4L);

        when(repository.findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                eq(TIER10_VEHICLE), eq("CURRENT"), any()))
                .thenReturn(new PageImpl<>(List.of(s4300, s4200a, s4200b, s4100)));
        when(repository.countCurrentGroupedByDamage(TIER10_VEHICLE))
                .thenReturn(List.of(
                        new Object[]{4300, 1L},
                        new Object[]{4200, 2L},
                        new Object[]{4100, 1L}));

        final HundredLeaderboardPageDto dto = leaderboardService.leaderboard(TIER10_VEHICLE, null, null, 1, 50);

        assertThat(dto.items()).extracting("rank").containsExactly(1, 2, 2, 4);
        assertThat(dto.items()).extracting("approvedAverageDamage").containsExactly(4300, 4200, 4200, 4100);
    }

    @Test
    void leaderboardTieAcrossPageBoundaryKeepsGlobalRank() {
        final HundredBattleSubmission s4200a = currentSubmission(4200);
        s4200a.setId(2L);
        final HundredBattleSubmission s4200b = currentSubmission(4200);
        s4200b.setId(3L);
        when(repository.findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                eq(TIER10_VEHICLE), eq("CURRENT"), any()))
                .thenReturn(new PageImpl<>(List.of(s4200a, s4200b)));
        when(repository.countCurrentGroupedByDamage(TIER10_VEHICLE))
                .thenReturn(List.of(new Object[]{4300, 1L}, new Object[]{4200, 2L}));

        final HundredLeaderboardPageDto dto = leaderboardService.leaderboard(TIER10_VEHICLE, null, null, 2, 2);

        assertThat(dto.items()).extracting("rank").containsExactly(2, 2);
    }

    @Test
    void defaultLeaderboardReturnsGlobalTopTenWithoutVehicleFilter() {
        final HundredBattleSubmission s4300 = currentSubmission(4300);
        s4300.setId(1L);
        final HundredBattleSubmission s4200 = currentSubmission(4200);
        s4200.setId(2L);
        s4200.setVehicleId(TIER10_VEHICLE_2);
        s4200.setVehicleName("B-C 25 t");

        when(repository.findTop10ByStatusAndApprovedAverageDamageIsNotNullOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                eq("CURRENT")))
                .thenReturn(List.of(s4300, s4200));
        when(repository.countAllCurrentGroupedByDamage())
                .thenReturn(List.of(new Object[]{4300, 1L}, new Object[]{4200, 1L}));

        final HundredLeaderboardPageDto dto = leaderboardService.leaderboard(null, null, null, 9, 100);

        assertThat(dto.vehicleId()).isNull();
        assertThat(dto.vehicleName()).isNull();
        assertThat(dto.page()).isEqualTo(1);
        assertThat(dto.size()).isEqualTo(10);
        assertThat(dto.totalItems()).isEqualTo(2);
        assertThat(dto.totalPages()).isEqualTo(1);
        assertThat(dto.items()).extracting("vehicleName").containsExactly("Progetto 65", "B-C 25 t");
        assertThat(dto.items()).extracting("rank").containsExactly(1, 2);
    }

    @Test
    void categoryLeaderboardUsesNationAndTypeIntersectionForRowsAndRanks() {
        final HundredBattleSubmission s4300 = currentSubmission(4300);
        s4300.setId(1L);
        s4300.setVehicleId(TIER10_VEHICLE_2);
        s4300.setVehicleName("B-C 25 t");
        final HundredBattleSubmission s4200 = currentSubmission(4200);
        s4200.setId(2L);
        s4200.setVehicleId(TIER10_VEHICLE_2);
        s4200.setVehicleName("B-C 25 t");

        when(repository.findDistinctCurrentVehicleIds())
                .thenReturn(List.of(TIER10_VEHICLE, TIER10_VEHICLE_2));
        when(repository.findTopCurrentByVehicleIds(eq(List.of(TIER10_VEHICLE_2)), any()))
                .thenReturn(List.of(s4300, s4200));
        when(repository.countCurrentGroupedByDamageForVehicles(eq(List.of(TIER10_VEHICLE_2))))
                .thenReturn(List.of(new Object[]{4300, 1L}, new Object[]{4200, 1L}));

        final HundredLeaderboardPageDto dto = leaderboardService.leaderboard(
                null, " france ", "light_tank", 8, 99);

        assertThat(dto.vehicleId()).isNull();
        assertThat(dto.page()).isEqualTo(1);
        assertThat(dto.size()).isEqualTo(10);
        assertThat(dto.items()).extracting("vehicleId")
                .containsOnly(TIER10_VEHICLE_2);
        assertThat(dto.items()).extracting("rank").containsExactly(1, 2);
        verify(repository).findTopCurrentByVehicleIds(eq(List.of(TIER10_VEHICLE_2)),
                eq(PageRequest.of(0, 10)));
    }

    @Test
    void categoryLeaderboardReturnsEmptyWhenIntersectionHasNoVehicles() {
        when(repository.findDistinctCurrentVehicleIds())
                .thenReturn(List.of(TIER10_VEHICLE, TIER10_VEHICLE_2));

        final HundredLeaderboardPageDto dto = leaderboardService.leaderboard(
                null, "CHINA", "HEAVY_TANK", 1, 50);

        assertThat(dto.items()).isEmpty();
        assertThat(dto.page()).isEqualTo(1);
        assertThat(dto.size()).isEqualTo(10);
        assertThat(dto.totalItems()).isZero();
        verify(repository, never()).findTopCurrentByVehicleIds(any(), any());
        verify(repository, never()).countCurrentGroupedByDamageForVehicles(any());
    }

    @Test
    void concreteVehicleReturnsEmptyWhenCategoryDoesNotMatch() {
        final HundredLeaderboardPageDto dto = leaderboardService.leaderboard(
                TIER10_VEHICLE, "FRANCE", "MEDIUM_TANK", 2, 20);

        assertThat(dto.vehicleId()).isEqualTo(TIER10_VEHICLE);
        assertThat(dto.vehicleName()).isEqualTo("Progetto 65");
        assertThat(dto.items()).isEmpty();
        assertThat(dto.page()).isEqualTo(2);
        assertThat(dto.size()).isEqualTo(20);
        assertThat(dto.totalItems()).isZero();
        verify(repository, never())
                .findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                        anyLong(), anyString(), any());
        verify(repository, never()).countCurrentGroupedByDamage(anyLong());
    }

    @Test
    void adminListCategoryFiltersWorkWithoutSelectingVehicle() {
        final HundredBattleSubmission matching = currentSubmission(4300);
        matching.setId(1L);
        when(repository.findDistinctVehicleIds())
                .thenReturn(List.of(TIER10_VEHICLE, TIER10_VEHICLE_2));
        when(repository.searchAdminByVehicleIds(
                eq("CURRENT"), eq(List.of(TIER10_VEHICLE)), eq(PageRequest.of(0, 50))))
                .thenReturn(new PageImpl<>(List.of(matching), PageRequest.of(0, 50), 1));

        final var dto = adminQueryService.adminList(
                "CURRENT", "EUROPE", "MEDIUM_TANK", null, 1, 50);

        assertThat(dto.items()).hasSize(1);
        assertThat(dto.items().getFirst().vehicleId()).isEqualTo(TIER10_VEHICLE);
        verify(repository, never()).searchAdmin(any(), any());
    }

    @Test
    void adminListVehicleAndCategoryAreAnIntersection() {
        final var dto = adminQueryService.adminList(
                null, "FRANCE", "LIGHT_TANK", TIER10_VEHICLE, 1, 50);

        assertThat(dto.items()).isEmpty();
        verify(repository, never()).searchAdminByVehicleIds(any(), any(), any());
        verify(repository, never()).searchAdmin(any(), any());
    }
}
