package com.wotb.parserworker.worker;

/**
 * A source failed because its derived artifacts could not be written to object storage.
 *
 * <p>The canonical runner reports a sink {@code IOException} as {@code PROCESSING_JOB_STORAGE_UNAVAILABLE}
 * and records it as a per-source failure. That is the right shape for the local control plane, where
 * the sink is a job directory on the same host and the failure belongs next to the source. In the
 * worker the same {@code IOException} means the <em>infrastructure</em> is unavailable: the replay
 * bytes were readable and the canonical parse succeeded, and only the write failed.</p>
 *
 * <p>Publishing it as a terminal per-source {@code FAILED} would tell the control plane that the
 * replay itself is unparseable and would acknowledge the request, losing a transient outage as a
 * permanent result. The handler therefore turns that classification back into an exception, so the
 * delivery leaves through the retryable {@code parser.failed} path instead.</p>
 */
public class ParserArtifactStorageException extends RuntimeException {

    private final String errorCode;

    public ParserArtifactStorageException(final String errorCode, final String message) {
        super(message);
        this.errorCode = errorCode;
    }

    /**
     * The stable code the canonical runner used, kept for logs and diagnosis. The code published on
     * the wire stays {@code PARSER_WORKER_STORAGE_UNAVAILABLE}, the same code the worker reports for
     * an unreadable input, because both are the same fact: object storage is unavailable.
     */
    public String errorCode() {
        return errorCode;
    }
}
