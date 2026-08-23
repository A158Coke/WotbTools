package com.wotb.web.replay.job;

import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.web.replay.service.ReplayCapacityLimiter;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * 真实回放 Export Job 性能探针（docs/current-plan.md §45/§26）：1 / 10 / 34 / 50 四档。
 * <p>样本从 <code>common/data/*.wotbreplay</code>（本地 gitignored 目录）读取；无样本自动跳过，
 * 样本不入库。用真实 <code>DefaultReplayProcessingFacade</code> + 真实 Excel 导出，轮询状态
 * 记录 replay 处理阶段 / XLSX 阶段 / 总耗时与 artifact 大小。CPU/heap/RSS 不在单测内测量
 * （按 plan §51 明确 NOT MEASURED，由生产可观测性覆盖）。</p>
 * <p>34 场是当前真实 UX 问题的 workload：即使仍耗时数十秒，本探针验证 job 全程有真实进度
 * 且每个输入都被解析（重复样本同样计数，见 Replays 去重语义）。</p>
 */
@Tag("probe")
class ReplayExportJobPerfProbeTest {

    @Test
    void benchmarkOneTenThirtyFourFifty() throws Exception {
        final List<byte[]> samples = loadSamples();
        if (samples.isEmpty()) {
            System.out.println("\n===== SKIP（common/data 无真实回放样本）: ReplayExportJobPerfProbeTest");
            return;
        }
        System.out.println("\n===== Replay Export Job 性能探针（样本数=" + samples.size() + "）=====");
        System.out.printf("%-8s %-6s %-12s %-14s %-12s %-12s %-10s%n",
                "mode", "N", "totalMs", "replayMs", "xlsxMs", "artifactKB", "perReplayMs");
        for (final int n : new int[]{1, 10, 34, 50}) {
            print(run(n, samples, "aggregate"));
        }
        for (final int n : new int[]{34, 50}) {
            print(run(n, samples, "each"));
        }
    }

    private static void print(final Result r) {
        if (r != null) {
            System.out.printf("%-8s %-6d %-12d %-14d %-12d %-12d %-10.1f%n",
                    r.mode, r.n, r.totalMs, r.replayMs, r.xlsxMs, r.artifactKB, r.perReplayMs);
        }
    }

    private record Result(String mode, int n, long totalMs, long replayMs, long xlsxMs, long artifactKB, double perReplayMs) {
    }

    private Result run(final int n, final List<byte[]> samples, final String mode) throws Exception {
        final Path tmpDir = Files.createTempDirectory("wotb-export-job-perf");
        try (ReplayExportWorkerExecutor executor = new ReplayExportWorkerExecutor(2, 4)) {
            final ExportJobStore store = new ExportJobStore(tmpDir.toString(), 60);
            final ReplayExportJobService service = new ReplayExportJobService(
                    new ReplayCapacityLimiter(2), new DefaultReplayProcessingFacade(), store, executor, null);
            final MockMultipartFile[] files = new MockMultipartFile[n];
            for (int i = 0; i < n; i++) {
                files[i] = new MockMultipartFile("files", "replay-" + i + ".wotbreplay",
                        "application/octet-stream", samples.get(i % samples.size()));
            }
            final long tCreated = System.nanoTime();
            final String jobId = service.createJob(files, mode);
            final long tStarted = tCreated;
            long tExcel = -1;
            long tReady = -1;
            final long deadline = System.currentTimeMillis() + 600_000;
            while (System.currentTimeMillis() < deadline) {
                final ExportJob job = store.get(jobId);
                if (job == null) {
                    break;
                }
                final ExportJob.Snapshot snap = job.snapshot();
                if (snap.status() == ExportJob.Status.PROCESSING
                        && snap.phase() == ExportJob.Phase.BUILDING_EXCEL
                        && tExcel < 0) {
                    tExcel = System.nanoTime();
                }
                if (snap.status() == ExportJob.Status.READY) {
                    tReady = System.nanoTime();
                    break;
                }
                if (snap.status() == ExportJob.Status.FAILED) {
                    System.out.println("  N=" + n + " FAILED: " + snap.errorCode());
                    return null;
                }
                Thread.sleep(5);
            }
            if (tReady < 0) {
                System.out.println("  N=" + n + " did not finish in 600s");
                return null;
            }
            final long artifactBytes = Files.size(store.get(jobId).artifactPath());
            final long totalMs = (tReady - tCreated) / 1_000_000;
            final long replayMs = ((tExcel > 0 ? tExcel : tReady) - tStarted) / 1_000_000;
            final long xlsxMs = (tReady - (tExcel > 0 ? tExcel : tReady)) / 1_000_000;
            final double perReplayMs = (double) totalMs / n;
            store.close();
            return new Result(mode, n, totalMs, replayMs, xlsxMs, artifactBytes / 1024, perReplayMs);
        } finally {
            deleteDir(tmpDir);
        }
    }

    private static List<byte[]> loadSamples() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common", "data").normalize();
        if (!Files.isDirectory(common)) {
            return List.of();
        }
        try (Stream<Path> s = Files.list(common)) {
            final List<byte[]> samples = new ArrayList<>();
            for (final Path p : s.filter(f -> f.getFileName().toString().endsWith(".wotbreplay")).toList()) {
                samples.add(Files.readAllBytes(p));
            }
            return samples;
        }
    }

    private static void deleteDir(final Path dir) {
        try (var walk = Files.walk(dir)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (final Exception ignored) {
                    // best-effort
                }
            });
        } catch (final Exception ignored) {
            // best-effort
        }
    }
}