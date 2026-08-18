package com.wotb.web.hof.service;

import com.wotb.web.hof.entity.HallOfFameAdminLog;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameAdminLogRepository;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.storage.HallOfFameReplayStorage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * admin delete 治理语义单元测试（mock，无 DB）：
 * 单事务 audit + delete、404、共享 hash 保留文件、最后引用删除文件、hash null 无文件清理、
 * audit 失败中止删除（不产生假删除）。真实 PG 并发 invariant 见 WebApiTest。
 */
class HallOfFameAdminServiceTest {

    private final HallOfFameRecordRepository repository = mock(HallOfFameRecordRepository.class);
    private final HallOfFameRecordMapper recordMapper = mock(HallOfFameRecordMapper.class);
    private final HallOfFameAdminLogRepository auditRepository = mock(HallOfFameAdminLogRepository.class);
    private final HallOfFameAdminAuditMapper auditMapper = mock(HallOfFameAdminAuditMapper.class);
    private final HallOfFameReplayStorage storage = mock(HallOfFameReplayStorage.class);
    private final ReplayHashLock replayHashLock = mock(ReplayHashLock.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);

    private HallOfFameAdminService service() {
        // mock txManager.getTransaction → null：TransactionTemplate.execute 仍会执行回调（单事务语义由真实 Spring 管理，
        // 单元测试只验证回调内的业务编排：audit+delete 顺序与失败传播）。
        return new HallOfFameAdminService(repository, recordMapper, auditRepository,
                auditMapper, storage, replayHashLock, txManager);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private static void login() {
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none")
                .subject("admin-sub").claim("preferred_username", "admin-user").build();
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
    }

    private static HallOfFameRecord record(final long id, final String hash) {
        final HallOfFameRecord r = new HallOfFameRecord();
        r.setId(id);
        r.setArenaId("arena-1");
        r.setAccountId(111L);
        r.setNickname("Player1");
        r.setTankId(6481L);
        r.setTankName("FV4005");
        r.setBattleType("RANDOM");
        r.setArenaBonusType(1);
        r.setDamageDealt(5000);
        r.setReplayHash(hash);
        return r;
    }

    private void runLockInline() {
        doAnswer(inv -> {
            ((Runnable) inv.getArgument(1)).run();
            return null;
        }).when(replayHashLock).runWithLock(anyString(), any(Runnable.class));
    }

    @Test
    void deleteSuccessCreatesAuditSnapshotAndDeletesRecordAndFile() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "a".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(repository.countByReplayHash("a".repeat(64))).thenReturn(0L);

        service().deleteEntry(42L);

        verify(auditRepository).save(any(HallOfFameAdminLog.class));
        verify(repository).delete(r);
        verify(storage).delete("a".repeat(64));
    }

    @Test
    void deleteAuditSnapshotContainsFullFacts() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "b".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(repository.countByReplayHash(anyString())).thenReturn(0L);

        service().deleteEntry(42L);

        final var captor = org.mockito.ArgumentCaptor.forClass(HallOfFameAdminLog.class);
        verify(auditRepository).save(captor.capture());
        final HallOfFameAdminLog log = captor.getValue();
        assertEquals("DELETE_ENTRY", log.getAction());
        assertEquals(42L, log.getRecordId());
        assertEquals("arena-1", log.getArenaId());
        assertEquals(111L, log.getAccountId());
        assertEquals("Player1", log.getNickname());
        assertEquals(6481L, log.getTankId());
        assertEquals("FV4005", log.getTankName());
        assertEquals(5000, log.getDamageDealt());
        assertEquals("RANDOM", log.getBattleType());
        assertEquals(1, log.getArenaBonusType());
        assertEquals("b".repeat(64), log.getReplayHash());
        assertEquals("admin-sub", log.getAdminKeycloakUserId());
        assertEquals("admin-user", log.getAdminUsername());
    }

    @Test
    void deleteMissingRecordReturns404() {
        login();
        when(repository.findById(99L)).thenReturn(Optional.empty());

        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service().deleteEntry(99L));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
        assertTrue(e.getReason() != null && e.getReason().contains("HOF_ENTRY_NOT_FOUND"));
        verify(auditRepository, never()).save(any());
        verify(repository, never()).delete(any());
    }

    @Test
    void deleteSharedHashRetainsPhysicalFile() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "c".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(repository.countByReplayHash("c".repeat(64))).thenReturn(2L);

        service().deleteEntry(42L);

        verify(auditRepository).save(any(HallOfFameAdminLog.class));
        verify(repository).delete(r);
        verify(storage, never()).delete(anyString());
    }

    @Test
    void deleteLastReferenceRemovesPhysicalFile() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "d".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(repository.countByReplayHash("d".repeat(64))).thenReturn(0L);

        service().deleteEntry(42L);

        verify(storage).delete("d".repeat(64));
    }

    @Test
    void deleteNullHashSkipsFileCleanup() {
        login();
        final HallOfFameRecord r = record(42L, null);
        when(repository.findById(42L)).thenReturn(Optional.of(r));

        service().deleteEntry(42L);

        verify(auditRepository).save(any(HallOfFameAdminLog.class));
        verify(repository).delete(r);
        verify(replayHashLock, never()).runWithLock(anyString(), any(Runnable.class));
        verify(storage, never()).delete(anyString());
    }

    @Test
    void auditFailureAbortsDelete() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "e".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(auditRepository.save(any(HallOfFameAdminLog.class)))
                .thenThrow(new RuntimeException("audit down"));

        assertThrows(RuntimeException.class, () -> service().deleteEntry(42L));
        verify(repository, never()).delete(any());
    }

    @Test
    void fileCleanupFailureIsSwallowedWithWarn() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "f".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(repository.countByReplayHash("f".repeat(64))).thenReturn(0L);
        when(storage.delete(anyString())).thenThrow(new RuntimeException("io fail"));

        // DB 删除已 commit 且权威：清理失败不抛给调用方，不留脏状态
        service().deleteEntry(42L);

        verify(auditRepository).save(any(HallOfFameAdminLog.class));
        verify(repository).delete(r);
    }

    @Test
    void searchRejectsInvalidBattleTypeFilter() {
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service().search(null, null, null, null, "TRAINING", null, null, null, 1, 50));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
    }
}