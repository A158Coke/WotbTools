package com.wotb.web.replay.job;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** ExportJob 状态机：终态 exactly once（plan §9/§40）。 */
class ExportJobTest {

    @Test
    void lifecycleQueuedToReadyExactlyOnce() {
        final ExportJob job = new ExportJob("j1", "aggregate", 3);
        assertEquals(ExportJob.Status.QUEUED, job.snapshot().status());

        assertTrue(job.startProcessing());
        assertFalse(job.startProcessing(), "QUEUED→PROCESSING 只能成功一次");
        assertEquals(ExportJob.Phase.PROCESSING_REPLAYS, job.snapshot().phase());

        job.updateProgress(2, 1, 0);
        assertEquals(2, job.snapshot().processed());
        assertEquals(1, job.snapshot().duplicates());

        assertTrue(job.advancePhase(ExportJob.Phase.BUILDING_EXCEL));
        assertEquals(ExportJob.Phase.BUILDING_EXCEL, job.snapshot().phase());

        final Path artifact = Path.of("result.xlsx");
        assertTrue(job.markReady("x.xlsx", "application/x", artifact));
        assertFalse(job.markReady("y.xlsx", "application/x", artifact), "READY 是终态，不能二次迁移");
        assertFalse(job.markFailed("X"), "READY 后不能再 FAILED");
        assertFalse(job.markCancelled(), "READY 后不能再 CANCELLED");

        final ExportJob.Snapshot snap = job.snapshot();
        assertEquals(ExportJob.Status.READY, snap.status());
        assertNotNull(snap.filename());
    }

    @Test
    void cancelWhileQueuedTerminatesImmediately() {
        final ExportJob job = new ExportJob("j2", "aggregate", 1);
        assertTrue(job.requestCancel());
        assertEquals(ExportJob.Status.CANCELLED, job.snapshot().status());
        assertFalse(job.startProcessing(), "已取消的 job 不能开始处理");
        assertFalse(job.markReady("x.xlsx", "m", null));
    }

    @Test
    void cancelWhileProcessingIsCooperative() {
        final ExportJob job = new ExportJob("j3", "aggregate", 1);
        assertTrue(job.startProcessing());
        assertTrue(job.requestCancel());
        assertTrue(job.isCancelled());
        // 协作取消：worker checkpoint 后自行终态
        assertEquals(ExportJob.Status.PROCESSING, job.snapshot().status());
        assertTrue(job.markCancelled());
        assertEquals(ExportJob.Status.CANCELLED, job.snapshot().status());
        assertFalse(job.requestCancel(), "终态后取消幂等返回 false");
    }

    @Test
    void failedIsTerminal() {
        final ExportJob job = new ExportJob("j4", "each", 2);
        assertTrue(job.startProcessing());
        assertTrue(job.markFailed("NO_VALID_REPLAYS"));
        assertEquals("NO_VALID_REPLAYS", job.snapshot().errorCode());
        assertFalse(job.markReady("x.xlsx", "m", null), "FAILED 后不能 READY");
    }
}
