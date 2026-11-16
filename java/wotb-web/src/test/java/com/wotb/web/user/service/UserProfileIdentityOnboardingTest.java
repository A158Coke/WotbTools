package com.wotb.web.user.service;

import com.wotb.web.user.api.UserProfileSnapshot;
import com.wotb.web.user.api.WotbAccountIdentity;
import com.wotb.web.user.dto.OnboardingReceiptDto;
import com.wotb.web.user.entity.UserProfile;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserProfileIdentityOnboardingTest extends UserProfileServiceTestSupport {

    @Test
    void currentWotbIdentityReturnsTheBoundServerAndAccount() {
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("ASIA", 123456L, "PlayerOne", null)));

        final WotbAccountIdentity identity = service.currentWotbIdentity("kc-user").orElseThrow();

        // 区服是业务身份的一部分：只返回账号 ID 会让 (CN, 123456) 与 (ASIA, 123456) 串号
        assertEquals("ASIA", identity.server());
        assertEquals(123456L, identity.accountId());
    }

    @Test
    void currentWotbIdentityIsEmptyWithoutAProfile() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        assertTrue(service.currentWotbIdentity("kc-user").isEmpty());
    }

    @Test
    void currentWotbIdentityIsEmptyWhenNoAccountIsBound() {
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("CN", null, null, null)));
        assertTrue(service.currentWotbIdentity("kc-user").isEmpty(),
                "未绑定账号不得解析出 canonical 身份，否则会按 0 号账号归属");

        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("CN", 0L, null, null)));
        assertTrue(service.currentWotbIdentity("kc-user").isEmpty());
    }

    @Test
    void onboardingStartsWithZeroNoneWithoutChangingTheProfileTransport() {
        final UserProfile profile = cnProfile(10L, "Player", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));
        assertEquals(new OnboardingReceiptDto(0, "NONE"), service.readOnboardingReceipt("kc-user"));
    }

    @Test
    void onboardingMergeIsMonotonicAndCompletionWinsAtTheSameEpoch() {
        final UserProfile profile = cnProfile(10L, "Player", null);
        when(repository.findByKeycloakUserIdForUpdate("kc-user")).thenReturn(Optional.of(profile));
        assertEquals(new OnboardingReceiptDto(2, "SKIPPED"), service.saveOnboardingReceipt("kc-user", 2, "SKIPPED"));
        assertEquals(new OnboardingReceiptDto(2, "SKIPPED"), service.saveOnboardingReceipt("kc-user", 1, "COMPLETED"));
        assertEquals(new OnboardingReceiptDto(2, "COMPLETED"), service.saveOnboardingReceipt("kc-user", 2, "COMPLETED"));
        assertEquals(new OnboardingReceiptDto(2, "COMPLETED"), service.saveOnboardingReceipt("kc-user", 2, "SKIPPED"));
        assertEquals(new OnboardingReceiptDto(2, "COMPLETED"), service.saveOnboardingReceipt("kc-user", 2, "COMPLETED"));
        assertEquals(new OnboardingReceiptDto(3, "SKIPPED"), service.saveOnboardingReceipt("kc-user", 3, "SKIPPED"));
        assertEquals(10L, profile.getWotbAccountId());
        assertEquals("Player", profile.getWotbNickname());
    }

    @Test
    void onboardingRequiresExistingProfileAndAValidTerminalReceipt() {
        assertEquals("PROFILE_NOT_FOUND", assertThrows(IllegalArgumentException.class,
                () -> service.readOnboardingReceipt("kc-user")).getMessage());
        assertEquals("PROFILE_NOT_FOUND", assertThrows(IllegalArgumentException.class,
                () -> service.saveOnboardingReceipt("kc-user", 1, "COMPLETED")).getMessage());
        assertEquals("INVALID_REQUEST", assertThrows(IllegalArgumentException.class,
                () -> service.saveOnboardingReceipt("kc-user", 0, "COMPLETED")).getMessage());
        for (final String disposition : new String[]{null, "NONE", "completed", ""}) {
            assertEquals("INVALID_REQUEST", assertThrows(IllegalArgumentException.class,
                    () -> service.saveOnboardingReceipt("kc-user", 1, disposition)).getMessage());
        }
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void crossDomainSnapshotMapsOnlyProfileValues() {
        final UserProfile profile = cnProfile(123L, "Player", null);
        profile.setDisplayName("Display Name");
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        final UserProfileSnapshot snapshot = service.findSnapshotByKeycloakUserId("kc-user").orElseThrow();

        assertEquals(profile.getId(), snapshot.id());
        assertEquals("kc-user", snapshot.keycloakUserId());
        assertEquals("Display Name", snapshot.displayName());
        assertEquals(123L, snapshot.wotbAccountId());
        assertEquals("Player", snapshot.wotbNickname());
        assertEquals("CN", snapshot.wotbServer());
    }

    @Test
    void administrationSearchOwnsSortingForAnUnfilteredPage() {
        final PageRequest pageable = PageRequest.of(3, 10, Sort.by(Sort.Direction.DESC, "createdAt"));
        final UserProfile profile = cnProfile(123L, "Player", null);
        when(repository.findAll(pageable)).thenReturn(new PageImpl<>(List.of(profile), pageable, 95));

        final var result = service.searchForAdministration(" \t ", 3, 10);

        verify(repository).findAll(pageable);
        assertEquals(3, result.getNumber());
        assertEquals(10, result.getSize());
        assertEquals(95, result.getTotalElements());
        assertEquals(10, result.getTotalPages());
        assertEquals(123L, result.getContent().getFirst().wotbAccountId());
    }

    @Test
    void administrationSearchTrimsQueryAndKeepsTheSameOwnedSort() {
        final PageRequest pageable = PageRequest.of(2, 25, Sort.by(Sort.Direction.DESC, "createdAt"));
        final UserProfile profile = cnProfile(456L, "Player", null);
        when(repository.searchAdminUsers("Player", pageable))
                .thenReturn(new PageImpl<>(List.of(profile), pageable, 140));

        final var result = service.searchForAdministration(" Player ", 2, 25);

        verify(repository).searchAdminUsers("Player", pageable);
        assertEquals(2, result.getNumber());
        assertEquals(25, result.getSize());
        assertEquals(140, result.getTotalElements());
        assertEquals(6, result.getTotalPages());
        assertEquals(456L, result.getContent().getFirst().wotbAccountId());
    }

    @Test
    void administrationDeleteLoadsAndFlushesEntityInsideUserDomain() {
        final UserProfile profile = cnProfile(123L, "Player", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.deleteForAdministration("kc-user");

        final var order = inOrder(repository);
        order.verify(repository).findByKeycloakUserId("kc-user");
        order.verify(repository).delete(profile);
        order.verify(repository).flush();
    }
}
