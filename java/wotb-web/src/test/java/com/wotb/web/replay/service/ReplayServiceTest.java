package com.wotb.web.replay.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.web.replay.dto.ExportResult;
import com.wotb.web.replay.dto.PreviewResponse;
import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ReplayServiceTest {

    @Test
    void rejectsNullReplayEntry() {
        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(new MultipartFile[]{null}));

        assertEquals("INVALID_REPLAY_FILE", error.getMessage());
    }

    @Test
    void rejectsTooManyReplayFilesBeforeReadingThem() {
        final MultipartFile file = multipartFile(1);
        final MultipartFile[] files = new MultipartFile[ReplayService.MAX_REPLAY_FILES + 1];
        Arrays.fill(files, file);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(files));

        assertEquals("TOO_MANY_REPLAY_FILES", error.getMessage());
    }

    @Test
    void rejectsOversizedReplayFile() {
        final MultipartFile file = multipartFile(ReplayService.MAX_REPLAY_FILE_BYTES + 1);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(new MultipartFile[]{file}));

        assertEquals("FILE_TOO_LARGE", error.getMessage());
    }

    @Test
    void rejectsOversizedAggregateRequest() {
        final MultipartFile file = multipartFile(ReplayService.MAX_REPLAY_FILE_BYTES);
        final MultipartFile[] files = new MultipartFile[11];
        Arrays.fill(files, file);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(files));

        assertEquals("REQUEST_TOO_LARGE", error.getMessage());
    }

    @Test
    void previewRunsFullProcessingAndEmbedsMetricsInBattleAndAggregate() throws Exception {
        final DefaultReplayProcessingFacade processingFacade = mock(DefaultReplayProcessingFacade.class);
        final Battle battle = new Battle();
        battle.arenaId = "preview-battle";
        battle.players = List.of(player(1L, 1), player(2L, 2));
        when(processingFacade.process(any(), eq(ReplayProcessingOptions.full()))).thenReturn(
                new ReplayProcessingResult("preview.wotbreplay", ReplayProcessingStatus.SUCCESS,
                        null, battle, null, null,
                        ReplayProcessingCapabilities.summaryOnly(false), null, null));
        final ReplayService service = new ReplayService(new ReplayCapacityLimiter(1), processingFacade, null);

        final PreviewResponse response = service.preview(new MultipartFile[]{ratingFile()});

        // 单场玩家表直接内嵌 Contribution/KAST/Impact（同一 authoritative facts，不重复解析）
        final Map<String, Object> cells = response.battles().getFirst().players().getFirst().cells();
        assertTrue(cells.containsKey("contribution"));
        assertTrue(cells.containsKey("kast"));
        assertTrue(cells.containsKey("impact"));
        // 2 人 battle 不满足标准 14 人 → HP unavailable：contribution/kast 必须为 null（不冒充 0），impact 恒有值
        assertTrue(cells.get("impact") instanceof Number, "Impact 不依赖 HP，应始终为数值");
        // 跨场汇总同样内嵌表现派生列（此处 1 场 → aggregate 为空）
        assertFalse(response.aggregateColumns().isEmpty());
        verify(processingFacade).process(any(), eq(ReplayProcessingOptions.full()));
    }

    @Test
    void exportRunsSameFullProcessingAsPreview() throws Exception {
        final DefaultReplayProcessingFacade processingFacade = mock(DefaultReplayProcessingFacade.class);
        final Battle battle = battle14();
        when(processingFacade.process(any(), eq(ReplayProcessingOptions.full()))).thenReturn(
                new ReplayProcessingResult("preview.wotbreplay", ReplayProcessingStatus.SUCCESS,
                        null, battle, null, null,
                        ReplayProcessingCapabilities.summaryOnly(false), null, null));
        final ReplayService service = new ReplayService(new ReplayCapacityLimiter(1), processingFacade, null);

        final ExportResult result = service.export(new MultipartFile[]{ratingFile()}, "aggregate");

        // BLOCKER #2 回归：export 必须走与 preview 完全相同的 full processing（不得 raw parse）
        verify(processingFacade).process(any(), eq(ReplayProcessingOptions.full()));
        assertNotNull(result);
        assertTrue(result.data().length > 0);
        // 单场 battle 已由 processFull 产出并 populate：Excel 列有值（HP 已知）
        assertTrue(battle.players.stream().allMatch(p -> p.contribution != null),
                "full processing 后 contribution 已 populate，Excel 不显示 --");
    }

    @Test
    void exportEachRunsSameFullProcessingAsPreview() throws Exception {
        final DefaultReplayProcessingFacade processingFacade = mock(DefaultReplayProcessingFacade.class);
        final Battle battle = battle14();
        when(processingFacade.process(any(), eq(ReplayProcessingOptions.full()))).thenReturn(
                new ReplayProcessingResult("preview.wotbreplay", ReplayProcessingStatus.SUCCESS,
                        null, battle, null, null,
                        ReplayProcessingCapabilities.summaryOnly(false), null, null));
        final ReplayService service = new ReplayService(new ReplayCapacityLimiter(1), processingFacade, null);

        final ExportResult result = service.export(new MultipartFile[]{ratingFile()}, "each");

        // mode=each 同样走 full processing（BLOCKER #2 回归）
        verify(processingFacade).process(any(), eq(ReplayProcessingOptions.full()));
        assertNotNull(result);
        assertTrue(result.data().length > 0);
        assertTrue(battle.players.stream().allMatch(p -> p.contribution != null));
    }

    /** 完整 14 人 HP 已知 battle（Kranvagn 4481 有 tankopedia base）。 */
    private static Battle battle14() {
        final Battle battle = new Battle();
        battle.arenaId = "export-battle";
        battle.winnerTeam = 1;
        final List<PlayerResult> players = new java.util.ArrayList<>();
        for (int i = 0; i < 14; i++) {
            players.add(player(i + 1L, i < 7 ? 1 : 2));
        }
        battle.players = players;
        return battle;
    }

    private static PlayerResult player(final long accountId, final int team) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = "p" + accountId;
        player.team = team;
        player.tankId = 4481L;
        return player;
    }

    private static MultipartFile ratingFile() throws Exception {
        final MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(1L);
        when(file.getOriginalFilename()).thenReturn("rating.wotbreplay");
        when(file.getBytes()).thenReturn(new byte[]{1});
        return file;
    }

    private static MultipartFile multipartFile(final long size) {
        final MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(size);
        return file;
    }
}
