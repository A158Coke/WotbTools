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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * {@code /api/replay/map-overview} Dataset 路径查询服务契约：
 * 只读 Processing Job cached {@code map-overview.json}，<b>不</b>重新 full
 * process（multipart 上传路径已废弃，服务不再持有 processingFacade）。
 * store 为单一强制构造器（production mandatory）——缺失 bean 启动即失败。
 */
class MapOverviewQueryServiceTest {

    private static MapOverview overview() {
        return new MapOverview(
                "malinovka", "Malinovka", java.util.Map.of("zh", "马利诺夫卡"), 1,
                new MapOverview.Bounds(0, 500, 0, 500), java.util.List.of(), null,
                java.util.List.of(), java.util.List.of(), null, java.util.List.of(),
                2, 123L);
    }

    /** 建一个已注册 source#0 的 Processing Job store；按 {@code status} 置位 source 状态，可选写 map-overview.json。 */
    private ReplayProcessingJobStore storeWithJob(final Path dir, final ReplayProcessingJob.SourceStatus status,
                                                  final boolean writeMapFile) throws Exception {
        final ReplayProcessingJobStore store = new ReplayProcessingJobStore(dir, 60);
        final Battle battle = new Battle();
        battle.arenaId = "arena-1";
        final ReplayProcessingJob job = new ReplayProcessingJob("j1", List.of("a.wotbreplay"));
        job.startProcessing();
        job.markSourceProcessing(0, "a.wotbreplay");
        if (writeMapFile) {
            ReplayArtifactWriter.writeMapOverview(store.jobDir("j1"), 0, overview());
        }
        if (status == ReplayProcessingJob.SourceStatus.READY) {
            job.markSourceReady(0);
            job.updateProgress(1, 0, 0);
            job.markReady(new ProcessedDataset(List.of(battle), List.of("a.wotbreplay"),
                    List.of(), List.of(), null, null));
        } else if (status == ReplayProcessingJob.SourceStatus.FAILED) {
            job.markSourceFailed(0, "boom");
        }
        store.register(job);
        return store;
    }

    private void cleanup(final Path dir, final ReplayProcessingJobStore store) {
        store.close();
        try (var walk = Files.walk(dir)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (final Exception ignored) {
                    // best-effort test cleanup
                }
            });
        } catch (final Exception ignored) {
            // best-effort test cleanup
        }
    }

    @Test
    void blankOrNullJobIdRejectsDatasetReference() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-test");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.PROCESSING, false);
        try {
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            for (final String jobId : new String[]{null, "", "   "}) {
                final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                        () -> service.buildOverviewFromDataset(jobId, 0));
                assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
                assertEquals("DATASET_REFERENCE_REQUIRED", e.getReason());
            }
        } finally {
            cleanup(dir, store);
        }
    }

    @Test
    void missingJobReturnsJobNotFound() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-test");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.PROCESSING, false);
        try {
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                    () -> service.buildOverviewFromDataset("missing", 0));
            assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
            assertEquals("JOB_NOT_FOUND", e.getReason());
        } finally {
            cleanup(dir, store);
        }
    }

    @Test
    void invalidSourceIndexReturnsSourceNotFound() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-test");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.PROCESSING, false);
        try {
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                    () -> service.buildOverviewFromDataset("j1", 5));
            assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
            assertEquals("SOURCE_NOT_FOUND", e.getReason());
        } finally {
            cleanup(dir, store);
        }
    }

    @Test
    void processingSourceReturnsSourceNotReady() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-test");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.PROCESSING, false);
        try {
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                    () -> service.buildOverviewFromDataset("j1", 0));
            assertEquals(HttpStatus.CONFLICT, e.getStatusCode());
            assertEquals("SOURCE_NOT_READY", e.getReason());
        } finally {
            cleanup(dir, store);
        }
    }

    @Test
    void failedSourceReturnsSourceProcessingFailed() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-test");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.FAILED, false);
        try {
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                    () -> service.buildOverviewFromDataset("j1", 0));
            assertEquals(HttpStatus.CONFLICT, e.getStatusCode());
            assertEquals("SOURCE_PROCESSING_FAILED", e.getReason());
        } finally {
            cleanup(dir, store);
        }
    }

    @Test
    void readySourceReadsMapOverviewArtifact() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-test");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.READY, true);
        try {
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            final MapOverview read = service.buildOverviewFromDataset("j1", 0);
            assertEquals("malinovka", read.mapCode());
        } finally {
            cleanup(dir, store);
        }
    }

    @Test
    void readySourceWithoutArtifactReturnsNull() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-mapoverview-test");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.READY, false);
        try {
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            assertNull(service.buildOverviewFromDataset("j1", 0));
        } finally {
            cleanup(dir, store);
        }
    }

    @Test
    void corruptMapOverviewArtifactReturnsDatasetUnavailableNotJobNotFound() throws Exception {
        final Path dir = Files.createTempDirectory("wotb-map-corrupt");
        final ReplayProcessingJobStore store = storeWithJob(dir, ReplayProcessingJob.SourceStatus.READY, false);
        try {
            // 手动写入 corrupt map-overview.json（readMapOverview 反序列化失败 → IOException）。
            // 这<b>不是</b>「job 不存在」——必须映射不可恢复的 503 DATASET_UNAVAILABLE，
            // 绝不 JOB_NOT_FOUND（否则前端会误触发 exactly-once full-process recovery）。
            final Path artifact = ReplayArtifactWriter.mapOverviewPath(store.jobDir("j1"), 0);
            Files.createDirectories(artifact.getParent());
            Files.writeString(artifact, "{not-valid-json");
            final MapOverviewQueryService service = new MapOverviewQueryService(store);
            final ResponseStatusException e = assertThrows(ResponseStatusException.class,
                    () -> service.buildOverviewFromDataset("j1", 0));
            assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatusCode());
            assertEquals("DATASET_UNAVAILABLE", e.getReason());
        } finally {
            cleanup(dir, store);
        }
    }
}
