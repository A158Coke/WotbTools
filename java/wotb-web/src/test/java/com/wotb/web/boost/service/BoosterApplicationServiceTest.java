package com.wotb.web.boost.service;

import com.wotb.web.admin.service.KeycloakAdminUserService;
import com.wotb.web.boost.dto.BoosterApplicationDto;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.boost.enums.BoosterApplicationStatus;
import com.wotb.web.boost.repository.BoosterApplicationRepository;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.service.UserNotificationService;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BoosterApplicationServiceTest {

    private static final String IMAGE = "data:image/png;base64,abc";

    @Mock
    BoosterApplicationRepository repository;

    @Mock
    BoosterApplicationMapper mapper;

    @Mock
    UserProfileService userProfileService;

    @Mock
    BoosterService boosterService;

    @Mock
    KeycloakAdminUserService keycloakAdminUserService;

    @Mock
    UserNotificationService notificationService;

    BoosterApplicationService service;

    @BeforeEach
    void setUp() {
        service = new BoosterApplicationService(
                repository,
                mapper,
                userProfileService,
                boosterService,
                keycloakAdminUserService,
                notificationService
        );
    }

    @Test
    void shouldReuseBoundWotbAccountWhenCreatingApplication() {
        when(userProfileService.findByKeycloakUserId(eq("kc-user")))
                .thenReturn(Optional.of(profile(1001L, "BoundName")));
        when(boosterService.findByKeycloakUserId(eq("kc-user"))).thenReturn(Optional.empty());
        when(repository.existsByKeycloakUserIdAndStatusIn(eq("kc-user"), any())).thenReturn(false);
        when(repository.saveAndFlush(any())).thenAnswer(invocation -> {
            final BoosterApplication application = invocation.getArgument(0);
            application.setId(7L);
            application.setCreatedAt(OffsetDateTime.now());
            return application;
        });

        service.create("kc-user", 2222L, "RequestName", "CN",
                IMAGE, IMAGE, "ELITE", "123456", null,
                "MONTH_20", "20:00-23:00", "self");

        final ArgumentCaptor<BoosterApplication> captor = ArgumentCaptor.forClass(BoosterApplication.class);
        verify(repository).saveAndFlush(captor.capture());
        assertThat(captor.getValue().getWotbAccountId()).isEqualTo(1001L);
        assertThat(captor.getValue().getWotbNickname()).isEqualTo("BoundName");
        assertThat(captor.getValue().getStatus()).isEqualTo(BoosterApplicationStatus.NEW.name());
    }

    @Test
    void shouldRejectMissingQq() {
        when(userProfileService.findByKeycloakUserId(eq("kc-user")))
                .thenReturn(Optional.of(profile(null, null)));
        when(boosterService.findByKeycloakUserId(eq("kc-user"))).thenReturn(Optional.empty());
        when(repository.existsByKeycloakUserIdAndStatusIn(eq("kc-user"), any())).thenReturn(false);

        assertThatThrownBy(() -> service.create("kc-user", 2222L, "RequestName", "CN",
                IMAGE, IMAGE, "ELITE", "", null,
                "MONTH_20", "20:00-23:00", "self"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("QQ_REQUIRED");
    }

    @Test
    void shouldRejectExistingBoosterApplication() {
        when(userProfileService.findByKeycloakUserId(eq("kc-user")))
                .thenReturn(Optional.of(profile(1001L, "BoundName")));
        when(boosterService.findByKeycloakUserId(eq("kc-user")))
                .thenReturn(Optional.of(new BoosterDto(1L, "B", "ELITE", "ELITE", "kc-user",
                        true, "ACTIVE", "ACTIVE", "QQ", "1", null, null,
                        0, null, null)));

        assertThatThrownBy(() -> service.create("kc-user", 2222L, "RequestName", "CN",
                IMAGE, IMAGE, "ELITE", "123456", null,
                "MONTH_20", "20:00-23:00", "self"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ALREADY_BOOSTER");
    }

    @Test
    void shouldAssignKeycloakRoleBeforeCreatingBoosterWhenApproving() {
        final BoosterApplication application = application();
        when(repository.findById(eq(9L))).thenReturn(Optional.of(application));
        when(boosterService.findByKeycloakUserId(eq("kc-user"))).thenReturn(Optional.empty());
        when(boosterService.create(eq("BoundName"), eq("ELITE"), eq("kc-user"),
                eq(true), eq("ACTIVE"), eq("QQ"), eq("123456"), eq("self"), any()))
                .thenReturn(new BoosterDto(33L, "BoundName", "ELITE", "ELITE", "kc-user",
                        true, "ACTIVE", "ACTIVE", "QQ", "123456", "self", "desc",
                        0, null, null));
        when(mapper.toDto(any())).thenReturn(dto());

        service.approve(9L, "admin-user", "ok");

        final InOrder inOrder = inOrder(keycloakAdminUserService, boosterService);
        inOrder.verify(keycloakAdminUserService).addRealmRole("kc-user", "booster");
        inOrder.verify(boosterService).create(eq("BoundName"), eq("ELITE"), eq("kc-user"),
                eq(true), eq("ACTIVE"), eq("QQ"), eq("123456"), eq("self"), any());
        assertThat(application.getStatus()).isEqualTo(BoosterApplicationStatus.APPROVED.name());
        assertThat(application.getApprovedBoosterId()).isEqualTo(33L);
        assertThat(application.getReviewedBy()).isEqualTo("admin-user");
    }

    private static UserProfileDto profile(final Long wotbAccountId, final String wotbNickname) {
        return new UserProfileDto(11L, "kc-user", "Display", "username",
                wotbAccountId, wotbNickname, "CN");
    }

    private static BoosterApplication application() {
        final BoosterApplication application = new BoosterApplication();
        application.setId(9L);
        application.setKeycloakUserId("kc-user");
        application.setUserProfileId(11L);
        application.setWotbAccountId(1001L);
        application.setWotbNickname("BoundName");
        application.setWotbServer("CN");
        application.setOverallStatsImage(IMAGE);
        application.setVehicleStatsImage(IMAGE);
        application.setRequestedLevel("ELITE");
        application.setQq("123456");
        application.setAvailabilityTier("MONTH_20");
        application.setDailyTimeWindow("20:00-23:00");
        application.setSelfAssessment("self");
        application.setStatus(BoosterApplicationStatus.NEW.name());
        return application;
    }

    private static BoosterApplicationDto dto() {
        return new BoosterApplicationDto(9L, "kc-user", 11L, 1001L, "BoundName",
                "CN", IMAGE, IMAGE, "ELITE", "123456", null, "MONTH_20",
                "20:00-23:00", "self", "APPROVED", "ok", 33L,
                "admin-user", OffsetDateTime.now(), OffsetDateTime.now(), OffsetDateTime.now());
    }
}
