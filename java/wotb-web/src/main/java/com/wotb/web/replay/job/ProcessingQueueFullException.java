package com.wotb.web.replay.job;

/** Processing Job 队列满载（与 Export 共用同一有界 worker 池）→ 503 PROCESSING_QUEUE_FULL。 */
public class ProcessingQueueFullException extends RuntimeException {

    public ProcessingQueueFullException() {
        super("PROCESSING_QUEUE_FULL");
    }
}
