package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AiReplayAnalysisServiceTest {

    private AiReplayAnalysisService service;

    @BeforeEach
    void setUp() {
        service = spy(new AiReplayAnalysisService("test-key", "https://fake.api", "test-model", 5));
    }

    // ======== 配置状态 ========

    @Test
    void notConfiguredThrowsSpecificException() {
        final var svc = new AiReplayAnalysisService("", "", "", 5);
        assertThrows(AiNotConfiguredException.class, () -> svc.analyze(new Battle(), null));
    }

    @Test
    void configuredDoesNotThrow() {
        assertTrue(service.isConfigured());
    }

    // ======== AI 调用次数控制流 ========

    @Test
    void noReconstructionCallsAnalyzeOnce() {
        doReturn(summaryResult()).when(service).analyze(any(), any());
        final var rep = makeNoReconResult();
        service.analyzePlayerOrFallback(rep);
        verify(service, times(1)).analyze(any(), any());
        verify(service, never()).analyzePlayerContext(any());
    }

    @Test
    void unresolvedRecorderCallsAnalyzeOnce() {
        doReturn(summaryResult()).when(service).analyze(any(), any());
        final var rep = makeUnresolvedRecorderResult();
        service.analyzePlayerOrFallback(rep);
        verify(service, times(1)).analyze(any(), any());
        verify(service, never()).analyzePlayerContext(any());
    }



    // ======== 辅助 ========

    private static AiReplayAnalysisService.AnalyzeResult ctxResult() {
        return new AiReplayAnalysisService.AnalyzeResult("ctx analysis", "model", List.of());
    }

    private static AiReplayAnalysisService.AnalyzeResult summaryResult() {
        return new AiReplayAnalysisService.AnalyzeResult("summary analysis", "model", List.of());
    }

    /** reconstruction 存在且包含录像者 participant（entityId 会因无 ParticipantMappingEvent 而为 null）。 */
    private static ReplayReconstruction makeReconWithParticipants() {
        return new ReplayReconstruction(null, null, 300f, null,
                List.of(new BattleParticipant(1000L, "P", 1, 0, "", true)),
                List.of(), List.of(), null, null, null);
    }

    /** reconstruction == null。 */
    private static ReplayProcessingResult makeNoReconResult() {
        final var battle = new Battle();
        battle.arenaId = "arena1"; battle.mapName = "m"; battle.arenaBonusType = 1;
        final var pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        battle.players = List.of(pr); battle.recorder = "P";
        final var caps = ReplayProcessingCapabilities.of(true, true, false, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        return new ReplayProcessingResult("n.wotbreplay", ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("h", null, null, null, 1000L, null),
                battle, null, null, caps, null, null);
    }

    /** reconstruction 存在但 recorder participant 未标记（无 BattleParticipant.recorder=true）。 */
    private static ReplayProcessingResult makeUnresolvedRecorderResult() {
        final var battle = new Battle();
        battle.arenaId = "arena1"; battle.mapName = "m"; battle.arenaBonusType = 1;
        final var pr = new PlayerResult(); pr.accountId = 1000L; pr.nickname = "P"; pr.team = 1;
        battle.players = List.of(pr); battle.recorder = "P";
        final var recon = new ReplayReconstruction(null, null, 300f, null,
                List.of(), List.of(), List.of(), null, null, null);
        final var caps = ReplayProcessingCapabilities.of(true, true, true, false, false, false, false, ReplayAnalysisScope.PLAYER_FOCUSED);
        return new ReplayProcessingResult("u.wotbreplay", ReplayProcessingStatus.SUCCESS,
                new ReplayIdentity("h", null, null, null, 1000L, null),
                battle, recon, null, caps, null, null);
    }


}
