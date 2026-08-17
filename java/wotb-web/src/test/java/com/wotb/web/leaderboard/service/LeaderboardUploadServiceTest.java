package com.wotb.web.leaderboard.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.leaderboard.dto.ReplayFileMeta;
import com.wotb.web.leaderboard.exception.LeaderboardStorageException;
import com.wotb.web.leaderboard.storage.LeaderboardReplayStorage;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Callable;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 上传编排契约测试（mock parse/storage/service，无 DB，任何环境可跑）。
 * 覆盖：存储 IOException 与 INVALID_REPLAY_FILE 隔离、DB 失败保留 orphan（v3 语义不删除）、
 * 未登录 401。
 */
class LeaderboardUploadServiceTest {

    private final Tankopedia tankopedia = Tankopedia.load();

    private LeaderboardService leaderboardService;
    private LeaderboardReplayStorage storage;
    private LeaderboardUploadService uploadService;

    @BeforeEach
    void setUp() throws Exception {
        leaderboardService = mock(LeaderboardService.class);
        storage = mock(LeaderboardReplayStorage.class);
        final ReplayCapacityLimiter limiter = mock(ReplayCapacityLimiter.class);
        doAnswer(inv -> ((Callable<?>) inv.getArgument(0)).call())
                .when(limiter).execute(any());
        uploadService = new LeaderboardUploadService(leaderboardService, limiter, storage);
        when(leaderboardService.eligibility(any())).thenReturn(RecordOutcome.SAVED);
        when(leaderboardService.preflightReplay(any(), any())).thenReturn(Optional.empty());
        login();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private static void login() {
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject("kc-user").build();
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
    }

    private static MockMultipartFile file() {
        return new MockMultipartFile("file", "battle.wotbreplay",
                "application/octet-stream", new byte[]{1, 2, 3});
    }

    private static Battle battle() {
        final Battle b = new Battle();
        b.arenaId = "arena-1";
        b.mapName = "rockfield";
        b.recorder = "Recorder1";
        b.arenaBonusType = 1;
        final List<PlayerResult> players = new ArrayList<>();
        final PlayerResult rec = new PlayerResult();
        rec.accountId = 111L;
        rec.nickname = "Recorder1";
        rec.tankId = 6481L;
        rec.damageDealt = 3200;
        players.add(rec);
        b.players = players;
        return b;
    }

    @Test
    void uploadStoresFileAndRecordsWithMeta() throws Exception {
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenReturn(battle());
            when(storage.store(any(byte[].class), anyString()))
                    .thenReturn(new LeaderboardReplayStorage.StoreResult(true, null));
            when(leaderboardService.recordRecorder(any(), any(), any())).thenReturn(RecordOutcome.SAVED);

            final Map<String, Object> result = uploadService.upload(file());

            assertEquals("ok", result.get("status"));
            assertEquals("arena-1", result.get("arenaId"));
            final var captor = org.mockito.ArgumentCaptor.forClass(ReplayFileMeta.class);
            verify(leaderboardService).recordRecorder(any(), any(), captor.capture());
            assertEquals(64, captor.getValue().sha256().length());
            assertEquals("battle.wotbreplay", captor.getValue().originalName());
            assertEquals(3L, captor.getValue().size());
            assertEquals("kc-user", captor.getValue().uploadedBy());
        }
    }

    @Test
    void storageErrorSurfacesAsReplayStorageErrorNotInvalidReplayFile() throws Exception {
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenReturn(battle());
            when(storage.store(any(byte[].class), anyString())).thenThrow(
                    new LeaderboardStorageException("REPLAY_STORAGE_ERROR",
                            HttpStatus.INTERNAL_SERVER_ERROR, "io failed"));

            final LeaderboardStorageException e = assertThrows(LeaderboardStorageException.class,
                    () -> uploadService.upload(file()));
            assertEquals("REPLAY_STORAGE_ERROR", e.getCode());
            verify(leaderboardService, never()).recordRecorder(any(), any(), any());
        }
    }

    @Test
    void dbFailureKeepsOrphanFileWithoutDeleting() throws Exception {
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenReturn(battle());
            when(storage.store(any(byte[].class), anyString()))
                    .thenReturn(new LeaderboardReplayStorage.StoreResult(true, null));
            when(leaderboardService.recordRecorder(any(), any(), any()))
                    .thenThrow(new DataAccessException("db down") {
                    });

            assertThrows(DataAccessException.class, () -> uploadService.upload(file()));
            // v3 语义：DB 失败不删除已入存储的文件（保留为安全 orphan）
            verify(storage, never()).delete(anyString());
        }
    }

    @Test
    void invalidReplayThrowsInvalidReplayFile() throws Exception {
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class)))
                    .thenThrow(new RuntimeException("bad file"));

            final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                    () -> uploadService.upload(file()));
            assertEquals("INVALID_REPLAY_FILE", e.getMessage());
            verify(storage, never()).store(any(byte[].class), anyString());
        }
    }

    @Test
    void nonRandomSkipsWithoutStoringFile() throws Exception {
        when(leaderboardService.eligibility(any())).thenReturn(RecordOutcome.SKIPPED_NON_RANDOM);
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenReturn(battle());

            final Map<String, Object> result = uploadService.upload(file());

            assertEquals("skipped", result.get("status"));
            assertEquals("NON_RANDOM_BATTLE", result.get("reasonCode"));
            verify(storage, never()).store(any(byte[].class), anyString());
            verify(leaderboardService, never()).recordRecorder(any(), any(), any());
        }
    }

    @Test
    void unknownRecorderSkipsWithoutStoringFile() throws Exception {
        when(leaderboardService.eligibility(any())).thenReturn(RecordOutcome.SKIPPED_UNKNOWN_RECORDER);
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenReturn(battle());

            final Map<String, Object> result = uploadService.upload(file());

            assertEquals("skipped", result.get("status"));
            assertEquals("DUPLICATE_OR_UNKNOWN_RECORDER", result.get("reasonCode"));
            verify(storage, never()).store(any(byte[].class), anyString());
        }
    }

    @Test
    void hashConflictSkipsWithoutStoringNewFile() throws Exception {
        when(leaderboardService.preflightReplay(any(), any()))
                .thenReturn(Optional.of(RecordOutcome.SKIPPED_HASH_CONFLICT));
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenReturn(battle());

            final Map<String, Object> result = uploadService.upload(file());

            assertEquals("skipped", result.get("status"));
            assertEquals("REPLAY_HASH_CONFLICT", result.get("reasonCode"));
            verify(storage, never()).store(any(byte[].class), anyString());
            verify(leaderboardService, never()).recordRecorder(any(), any(), any());
        }
    }

    @Test
    void idempotentPreflightStillStoresToRebuildMissingFile() throws Exception {
        try (final var mocked = mockStatic(ReplayParser.class)) {
            mocked.when(() -> ReplayParser.parse(any(byte[].class))).thenReturn(battle());
            when(leaderboardService.preflightReplay(any(), any()))
                    .thenReturn(Optional.of(RecordOutcome.IDEMPOTENT));
            when(storage.store(any(byte[].class), anyString()))
                    .thenReturn(new LeaderboardReplayStorage.StoreResult(false, null));
            when(leaderboardService.recordRecorder(any(), any(), any())).thenReturn(RecordOutcome.IDEMPOTENT);

            final Map<String, Object> result = uploadService.upload(file());

            assertEquals("ok", result.get("status"));
            verify(storage).store(any(byte[].class), anyString());
            verify(leaderboardService).recordRecorder(any(), any(), any());
        }
    }

    @Test
    void originalNameFallsBackWhenNoValidBasename() {
        assertEquals("replay.wotbreplay", LeaderboardUploadService.originalName(
                new MockMultipartFile("file", "/", "application/octet-stream", new byte[]{1})));
        assertEquals("replay.wotbreplay", LeaderboardUploadService.originalName(
                new MockMultipartFile("file", "\\", "application/octet-stream", new byte[]{1})));
        assertEquals("replay.wotbreplay", LeaderboardUploadService.originalName(
                new MockMultipartFile("file", "foo/", "application/octet-stream", new byte[]{1})));
        assertEquals("replay.wotbreplay", LeaderboardUploadService.originalName(
                new MockMultipartFile("file", "foo\\", "application/octet-stream", new byte[]{1})));
        assertEquals("replay.wotbreplay", LeaderboardUploadService.originalName(
                new MockMultipartFile("file", "   ", "application/octet-stream", new byte[]{1})));
    }

    @Test
    void originalNameKeepsBasenameAndTrimsOverlong() {
        assertEquals("battle.wotbreplay", LeaderboardUploadService.originalName(file()));
        assertEquals("b.wotbreplay", LeaderboardUploadService.originalName(
                new MockMultipartFile("file", "dir/b.wotbreplay", "application/octet-stream", new byte[]{1})));
        assertEquals("c.wotbreplay", LeaderboardUploadService.originalName(
                new MockMultipartFile("file", "a\\b\\c.wotbreplay", "application/octet-stream", new byte[]{1})));
        final String longName = "x".repeat(300) + ".wotbreplay";
        assertEquals(255, LeaderboardUploadService.originalName(
                new MockMultipartFile("file", longName, "application/octet-stream", new byte[]{1})).length());
    }

    @Test
    void uploadRequiresLogin() throws Exception {
        SecurityContextHolder.clearContext();
        final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> uploadService.upload(file()));
        assertEquals(401, e.getStatusCode().value());
        assertTrue(e.getReason() != null && e.getReason().contains("AUTHENTICATION_REQUIRED"));
    }
}