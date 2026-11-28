package com.wotb.web.hof.service;

import com.wotb.web.hof.dto.BulkDeleteItemResult;
import com.wotb.web.hof.dto.BulkDeleteResultDto;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameAdminLogRepository;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.hundred.service.HundredBattleMapper;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredModerationService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import com.wotb.web.mark3.service.Mark3Mapper;
import com.wotb.web.mark3.service.Mark3ReplayEvidenceService;
import com.wotb.web.mark3.service.Mark3ModerationService;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import com.wotb.web.replayfile.HallOfFameReplayStorage;
import com.wotb.web.replayfile.HundredReplayReferenceCounter;
import com.wotb.web.replayfile.ReplayHashLock;
import com.wotb.web.user.api.UserProfiles;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HofBulkDeleteTest {

    private static final String ADMIN_SUB = "admin-sub";
    private static final String WOTB_SERVER = "CN";

    private final HundredBattleSubmissionRepository hundredRepository =
            mock(HundredBattleSubmissionRepository.class);
    private final com.wotb.web.hundred.repository.HundredAdminLogRepository hundredAuditRepository =
            mock(com.wotb.web.hundred.repository.HundredAdminLogRepository.class);
    private final HundredBattleMapper hundredMapper = mock(HundredBattleMapper.class);
    private final HundredReplayEvidenceService hundredEvidence = mock(HundredReplayEvidenceService.class);
    private final UserProfiles userProfileService = mock(UserProfiles.class);
    private final ReplayHashLock replayHashLock = mock(ReplayHashLock.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);

    private final Mark3SubmissionRepository mark3Repository = mock(Mark3SubmissionRepository.class);
    private final Mark3Mapper mark3Mapper = mock(Mark3Mapper.class);
    private final Mark3ReplayEvidenceService mark3Evidence = mock(Mark3ReplayEvidenceService.class);
    private final ReplayCapacityLimiter replayCapacityLimiter = mock(ReplayCapacityLimiter.class);

    private final HallOfFameRecordRepository recordRepository = mock(HallOfFameRecordRepository.class);
    private final HallOfFameRecordMapper recordMapper = mock(HallOfFameRecordMapper.class);
    private final HallOfFameAdminLogRepository auditRepository = mock(HallOfFameAdminLogRepository.class);
    private final HallOfFameAdminAuditMapper auditMapper = mock(HallOfFameAdminAuditMapper.class);
    private final HallOfFameReplayStorage storage = mock(HallOfFameReplayStorage.class);
    private final HallOfFameService hallOfFameService = mock(HallOfFameService.class);
    private final HundredReplayReferenceCounter hundredReplayReferenceCounter =
            mock(HundredReplayReferenceCounter.class);

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void hundredBulkDeleteRepeatsSingleRecordSemanticsPerId() {
        // 百场删除已状态无关：CURRENT 与非 CURRENT（含软删 DELETED 墓碑）全部物理删除
        final HundredBattleSubmission current = hundredSubmission(1L, "CURRENT");
        final HundredBattleSubmission tombstone = hundredSubmission(2L, "DELETED");
        when(hundredRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(current));
        when(hundredRepository.findByIdForUpdate(2L)).thenReturn(Optional.of(tombstone));
        when(hundredRepository.findByIdForUpdate(3L)).thenReturn(Optional.empty());

        final com.wotb.web.hundred.dto.BulkDeleteResultDto result = hundredModerationService().bulkDeleteSubmissions(
                ADMIN_SUB, null, List.of(1L, 2L, 3L), "ADMIN_CORRECTION", null);

        assertEquals(3, result.requested());
        assertEquals(2, result.deleted());
        assertEquals(1, result.failed());
        assertEquals(List.of(true, true, false),
                result.results().stream().map(com.wotb.web.hundred.dto.BulkDeleteItemResult::deleted).toList());

        assertEquals("HUNDRED_SUBMISSION_NOT_FOUND", result.results().get(2).errorCode());
        verify(hundredEvidence).discardForSubmission(1L);
        verify(hundredEvidence).discardForSubmission(2L);
        verify(hundredRepository).delete(current);
        verify(hundredRepository).delete(tombstone);
        verify(hundredAuditRepository, org.mockito.Mockito.times(2)).save(any());
    }

    @Test
    void hundredBulkDeleteValidatesReasonOnceForTheWholeBatch() {
        assertThrows(IllegalArgumentException.class,
                () -> hundredModerationService().bulkDeleteSubmissions(
                        ADMIN_SUB, null, List.of(1L), "NOT_A_CATEGORY", null));
        verify(hundredRepository, never()).findByIdForUpdate(anyLong());
    }

    @Test
    void hundredBulkDeleteRejectsOversizedReasonTextBeforeAnyDeletion() {
        assertThrows(IllegalArgumentException.class,
                () -> hundredModerationService().bulkDeleteSubmissions(
                        ADMIN_SUB, null, List.of(1L, 2L), "ADMIN_CORRECTION", "x".repeat(501)));
        verify(hundredRepository, never()).findByIdForUpdate(anyLong());
        verify(hundredEvidence, never()).discardForSubmission(anyLong());
    }

    @Test
    void hundredBulkDeleteRequestNormalizesIdsAndEnforcesLimit() {
        final var request = new com.wotb.web.hundred.dto.BulkDeleteModerationRequest(
                java.util.Arrays.asList(1L, 2L, 1L, null), "ADMIN_CORRECTION", null);
        assertEquals(List.of(1L, 2L), request.normalizedIds());
        assertThrows(IllegalArgumentException.class,
                () -> new com.wotb.web.hundred.dto.BulkDeleteModerationRequest(
                        java.util.stream.LongStream.rangeClosed(1, 101).boxed().toList(),
                        "ADMIN_CORRECTION", null).normalizedIds());
    }

    @Test
    void mark3BulkDeleteRepeatsSingleRecordSemanticsPerId() {
        final Mark3Submission current = mark3Submission(11L, "CURRENT");
        final Mark3Submission rejected = mark3Submission(12L, "REJECTED");
        when(mark3Repository.findByIdForUpdate(11L)).thenReturn(Optional.of(current));
        when(mark3Repository.findByIdForUpdate(12L)).thenReturn(Optional.of(rejected));
        when(mark3Repository.save(any(Mark3Submission.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        final com.wotb.web.mark3.dto.BulkDeleteResultDto result = mark3ModerationService().bulkDeleteCurrent(
                ADMIN_SUB, List.of(11L, 12L), "ADMIN_CORRECTION", null);

        assertEquals(2, result.requested());
        assertEquals(1, result.deleted());
        assertEquals(1, result.failed());
        assertEquals("DELETED", current.getStatus());
        assertEquals("REJECTED", rejected.getStatus());
        assertEquals("MARK3_NOT_CURRENT", result.results().get(1).errorCode());
        verify(mark3Evidence).discardForSubmission(11L);
        verify(mark3Evidence, never()).discardForSubmission(12L);
    }

    @Test
    void singleRecordBulkDeleteContinuesAfterAnUnknownId() {
        loginAsAdmin();
        when(recordRepository.findById(1L)).thenReturn(Optional.of(record(1L)));
        when(recordRepository.findById(2L)).thenReturn(Optional.empty());

        final BulkDeleteResultDto result = hofAdminService().bulkDelete(List.of(1L, 2L));

        assertEquals(2, result.requested());
        assertEquals(1, result.deleted());
        assertEquals(1, result.failed());
        assertEquals("HOF_ENTRY_NOT_FOUND", result.results().get(1).errorCode());
        verify(recordRepository).delete(any(HallOfFameRecord.class));
    }

    private HundredModerationService hundredModerationService() {
        return new HundredModerationService(hundredRepository, hundredAuditRepository,
                hundredMapper, hundredEvidence, txManager);
    }

    private Mark3ModerationService mark3ModerationService() {
        return new Mark3ModerationService(mark3Repository, mark3Mapper, mark3Evidence, txManager);
    }

    private HallOfFameAdminService hofAdminService() {
        return new HallOfFameAdminService(recordRepository, recordMapper, auditRepository, auditMapper,
                storage, replayHashLock, hallOfFameService, hundredReplayReferenceCounter, txManager);
    }

    private static HundredBattleSubmission hundredSubmission(final long id, final String status) {
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setId(id);
        submission.setStatus(status);
        submission.setVehicleId(6481L);
        submission.setWotbServer(WOTB_SERVER);
        submission.setWotbAccountId(100L);
        submission.setNicknameSnapshot("Snap");
        return submission;
    }

    private static Mark3Submission mark3Submission(final long id, final String status) {
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(id);
        submission.setStatus(status);
        submission.setVehicleId(6481L);
        submission.setWotbServer(WOTB_SERVER);
        submission.setWotbAccountId(100L);
        submission.setNicknameSnapshot("Snap");
        return submission;
    }

    private static HallOfFameRecord record(final long id) {
        final HallOfFameRecord record = new HallOfFameRecord();
        record.setId(id);
        record.setArenaId("arena-" + id);
        record.setAccountId(100L);
        record.setNickname("Snap");
        record.setTankId(6481L);
        record.setTankName("FV4005");
        record.setBattleType("RANDOM");
        record.setArenaBonusType(1);
        record.setDamageDealt(5000);
        return record;
    }

    private static void loginAsAdmin() {
        final Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject(ADMIN_SUB)
                .claim("preferred_username", "admin-user")
                .build();
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
    }
}
