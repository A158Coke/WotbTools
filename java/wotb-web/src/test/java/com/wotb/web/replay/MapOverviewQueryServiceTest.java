package com.wotb.web.replay;

import com.wotb.core.model.Battle;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.job.ProcessedDataset;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * {@code /api/replay/map-overview} Dataset 路径查询服务契约（BLOCKER 2）：
 * 只读 Processing Job cached {@code map-overview.json}，<b>不</b>重新 full
 * process（multipart 上传路径已废弃，服务不再持有 processingFacade）。
 */
class MapOverviewQueryServiceTest {

    @Test
    void buildsOverviewFromDatasetArtifactWithoutProcessingFacade() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-dataset-test");
        final ReplayProcessingJobStore store = new ReplayProcessingJobStore(dir, 60);
        try {
            final MapOverview overview = new MapOverview(
                    "malinovka", "Malinovka", java.util.Map.of("zh", "马利诺夫卡"), 1,
                    new MapOverview.Bounds(0, 500, 0, 500), java.util.List.of(), null,
                    java.util.List.of(), java.util.List.of(), null, java.util.List.of(),
                    2, 123L, null);
            final Battle battle = new Battle();
            battle.arenaId = "arena-1";
            final ReplayProcessingJob job = new ReplayProcessingJob("j1", List.of("a.wotbreplay"));
            job.startProcessing();
            job.markSourceProcessing(0, "a.wotbreplay");
            ReplayArtifactWriter.writeMapOverview(store.jobDir("j1"), 0, overview);
            job.markSourceReady(0);
            job.updateProgress(1, 0, 0);
            job.markReady(new ProcessedDataset(List.of(battle), List.of("a.wotbreplay"),
                    List.of(), List.of(), null, null));
            store.register(job);

            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            final MapOverview read = service.buildOverviewFromDataset("j1", 0);

            assertNotNull(read);
            assertEquals("malinovka", read.mapCode());
        } finally {
            store.close();
            try (var walk = Files.walk(dir)) {
                walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                    try {
                        Files.deleteIfExists(p);
                    } catch (final Exception ignored) {
                        // best-effort test cleanup
                    }
                });
            }
        }
    }

    @Test
    void datasetPathReturnsNullWhenArtifactUnavailableAndRejectsNotReadySource() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-dataset-test");
        final ReplayProcessingJobStore store = new ReplayProcessingJobStore(dir, 60);
        try {
            final Battle battle = new Battle();
            battle.arenaId = "arena-1";
            final ReplayProcessingJob job = new ReplayProcessingJob("j1", List.of("a.wotbreplay"));
            job.startProcessing();
            job.markSourceProcessing(0, "a.wotbreplay");
            store.register(job);

            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            // BLOCKER 4：Dataset reference 契约改为稳定 ResponseStatusException（HTTP 409/404）。
            final ResponseStatusException notReady = assertThrows(ResponseStatusException.class,
                    () -> service.buildOverviewFromDataset("j1", 0), "未 READY 必须 SOURCE_NOT_READY");
            assertEquals(HttpStatus.CONFLICT, notReady.getStatusCode());
            assertEquals("SOURCE_NOT_READY", notReady.getReason());
            final ResponseStatusException missing = assertThrows(ResponseStatusException.class,
                    () -> service.buildOverviewFromDataset("missing", 0), "job 不存在必须 JOB_NOT_FOUND");
            assertEquals(HttpStatus.NOT_FOUND, missing.getStatusCode());
            assertEquals("JOB_NOT_FOUND", missing.getReason());
        } finally {
            store.close();
            try (var walk = Files.walk(dir)) {
                walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                    try {
                        Files.deleteIfExists(p);
                    } catch (final Exception ignored) {
                        // best-effort test cleanup
                    }
                });
            }
        }
    }
}
