package com.wotb.web.user.service;

import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.controller.UserProfileController;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.aop.AopAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.transaction.autoconfigure.TransactionAutoConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 使用实际 Boot 代理与事务 advice，repository 不依赖数据库。 */
class UserProfileApiTransactionTest {

    private final UserProfileRepository repository = mock(UserProfileRepository.class);
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AopAutoConfiguration.class, TransactionAutoConfiguration.class))
            .withUserConfiguration(ProfileConfiguration.class)
            .withBean(UserProfileRepository.class, () -> repository)
            .withBean(RecordingTransactions.class, RecordingTransactions::new);

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void apiAndConcreteInjectionShareTheDefaultBootProxyAndReadOnlyTransaction() {
        when(repository.findByKeycloakUserId("kc-user")).thenAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertTrue(TransactionSynchronizationManager.isCurrentTransactionReadOnly());
            return Optional.of(boundProfile());
        });

        runner.run(context -> {
            assertThat(context).hasNotFailed();
            final UserProfiles api = context.getBean(UserProfiles.class);
            assertSame(context.getBean(UserProfileService.class), api);
            assertTrue(AopUtils.isCglibProxy(api));
            assertNotNull(context.getBean(UserProfileController.class));
            assertEquals(123L, api.findSnapshotByKeycloakUserId("kc-user").orElseThrow().wotbAccountId());
            final RecordingTransactions transactions = context.getBean(RecordingTransactions.class);
            assertEquals(1, transactions.begins);
            assertEquals(1, transactions.commits);
            assertEquals(0, transactions.rollbacks);
        });
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
    }

    @Test
    void synchronizationThroughApiCommitsOneActiveWriteTransaction() {
        final Jwt jwt = Jwt.withTokenValue("test-token").header("alg", "none").subject("kc-user")
                .claim("preferred_username", "wg_eu_123")
                .claim("displayName", "PlayerOne")
                .claim("wotb_region", "EU")
                .claim("wotb_account_id", "123")
                .claim("wotb_nickname", "PlayerOne")
                .claim("wotb_verified", true).build();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());
        when(repository.save(any(UserProfile.class))).thenAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            assertFalse(TransactionSynchronizationManager.isCurrentTransactionReadOnly());
            final UserProfile profile = invocation.getArgument(0);
            assertEquals("EU", profile.getWotbServer());
            assertEquals(123L, profile.getWotbAccountId());
            assertEquals("WARGAMING", profile.getWotbAccountSource());
            return profile;
        });

        runner.run(context -> {
            assertThat(context).hasNotFailed();
            context.getBean(UserProfiles.class).synchronizeFromLogin("kc-user");
            final RecordingTransactions transactions = context.getBean(RecordingTransactions.class);
            assertEquals(1, transactions.begins);
            assertEquals(1, transactions.commits);
            assertEquals(0, transactions.rollbacks);
        });
        verify(repository).save(any(UserProfile.class));
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
    }

    @Test
    void invalidIdentityRollsBackTheApiTransactionAndPreservesError() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                    () -> context.getBean(UserProfiles.class).synchronizeFromLogin("kc-user"));
            assertEquals("WOTB_CLAIMS_INVALID", error.getMessage());
            final RecordingTransactions transactions = context.getBean(RecordingTransactions.class);
            assertEquals(1, transactions.begins);
            assertEquals(0, transactions.commits);
            assertEquals(1, transactions.rollbacks);
        });
        verify(repository, never()).save(any(UserProfile.class));
        assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
    }

    @Test
    void ensureKeepsItsDeliberateAbsenceOfAnOuterTransaction() {
        when(repository.findByKeycloakUserId("kc-user")).thenAnswer(invocation -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            return Optional.of(boundProfile());
        });

        runner.run(context -> {
            assertThat(context).hasNotFailed();
            final UserProfileService service = context.getBean(UserProfileService.class);
            assertEquals(123L, service.ensureCurrentProfile("kc-user", "unused", "unused").wotbAccountId());
            final RecordingTransactions transactions = context.getBean(RecordingTransactions.class);
            assertEquals(0, transactions.begins);
            assertEquals(0, transactions.commits);
            assertEquals(0, transactions.rollbacks);
        });
    }

    private static UserProfile boundProfile() {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setWotbAccountId(123L);
        return profile;
    }

    @Configuration(proxyBeanMethods = false)
    @Import({UserProfileService.class, UserProfileMapper.class, UserProfileController.class})
    static class ProfileConfiguration {
    }

    private static final class RecordingTransactions extends AbstractPlatformTransactionManager {
        private int begins;
        private int commits;
        private int rollbacks;

        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        @Override
        protected void doBegin(final Object transaction, final TransactionDefinition definition) {
            begins++;
        }

        @Override
        protected void doCommit(final DefaultTransactionStatus status) {
            commits++;
        }

        @Override
        protected void doRollback(final DefaultTransactionStatus status) {
            rollbacks++;
        }
    }
}
