package com.wotb.web.hof.service;

import com.wotb.web.hof.entity.HallOfFameAdminLog;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameAdminLogRepository;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.ReplayHashLock;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HallOfFameAdminServiceTest {

    private final HallOfFameRecordRepository repository = mock(HallOfFameRecordRepository.class);
    private final HallOfFameRecordMapper recordMapper = mock(HallOfFameRecordMapper.class);
    private final HallOfFameAdminLogRepository auditRepository = mock(HallOfFameAdminLogRepository.class);
    private final HallOfFameAdminAuditMapper auditMapper = mock(HallOfFameAdminAuditMapper.class);
    private final HallOfFameReplayStorage storage = mock(HallOfFameReplayStorage.class);
    private final ReplayHashLock replayHashLock = mock(ReplayHashLock.class);
    private final HallOfFameService hallOfFameService = mock(HallOfFameService.class);
    private final com.wotb.web.replayfile.HundredReplayReferenceCounter hundredReplayReferenceCounter =
            mock(com.wotb.web.replayfile.HundredReplayReferenceCounter.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);

    private HallOfFameAdminService service() {
        return new HallOfFameAdminService(repository, recordMapper, auditRepository,
                auditMapper, storage, replayHashLock, hallOfFameService, hundredReplayReferenceCounter, txManager);
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
        when(repository.countByReplayHash("c".repeat(64))).thenReturn(1L);
        when(hundredReplayReferenceCounter.countHundredReferences("c".repeat(64))).thenReturn(0L);

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
        when(hundredReplayReferenceCounter.countHundredReferences("d".repeat(64))).thenReturn(0L);

        service().deleteEntry(42L);

        verify(storage).delete("d".repeat(64));
    }

    @Test
    void deleteLastHoFReferenceRetainsFileWhenHundredEvidenceStillReferences() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "e".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(hundredReplayReferenceCounter.countHundredReferences("e".repeat(64))).thenReturn(1L);

        service().deleteEntry(42L);

        verify(auditRepository).save(any(HallOfFameAdminLog.class));
        verify(repository).delete(r);
        verify(storage, never()).delete(anyString());
    }

    @Test
    void deleteRetainsFileWhenBothDomainsReference() {
        login();
        runLockInline();
        final HallOfFameRecord r = record(42L, "f".repeat(64));
        when(repository.findById(42L)).thenReturn(Optional.of(r));
        when(repository.countByReplayHash("f".repeat(64))).thenReturn(1L);
        when(hundredReplayReferenceCounter.countHundredReferences("f".repeat(64))).thenReturn(1L);

        service().deleteEntry(42L);

        verify(auditRepository).save(any(HallOfFameAdminLog.class));
        verify(repository).delete(r);
        verify(storage, never()).delete(anyString());
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

        service().deleteEntry(42L);

        verify(auditRepository).save(any(HallOfFameAdminLog.class));
        verify(repository).delete(r);
    }

    @Test
    void searchRejectsInvalidBattleTypeFilter() {
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> service().search(null, null, null, "TRAINING", null, null, null, 1, 50));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
    }

    @Test
    void categoryFiltersIndependentlyReachAdminRepositoryIntersection() {
        when(hallOfFameService.matchingVehicleIds("EUROPE", "MEDIUM_TANK", 10))
                .thenReturn(List.of(385L));
        when(repository.adminSearchByVehicleIds(any(), any(), any(), any(), any(), any(), any(),
                any(Pageable.class))).thenReturn(Page.empty());

        service().search(null, null, null, null, null,
                "EUROPE", "MEDIUM_TANK", 10, null, null, 1, 50);

        verify(repository).adminSearchByVehicleIds(any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.eq(List.of(385L)), any(), any(Pageable.class));
        verify(repository, never()).adminSearch(any(), any(), any(), any(), any(), any(), any(Pageable.class));
    }

}
