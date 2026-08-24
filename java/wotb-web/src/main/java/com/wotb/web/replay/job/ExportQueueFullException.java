package com.wotb.web.replay.job;

/** Export Job 队列满载（workers + queue 全占用）→ 503 EXPORT_QUEUE_FULL。 */
public class ExportQueueFullException extends RuntimeException {

    public ExportQueueFullException() {
        super("EXPORT_QUEUE_FULL");
    }
}
