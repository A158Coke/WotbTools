package com.wotb.parserworker.worker;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.storage.ObjectStorageKeys;
import com.wotb.web.replay.job.ReplayArtifactSink;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Object-storage implementation of the artifact sink: writes derived artifacts below the job's
 * {@code artifacts/<sourceIndex>/} prefix, with keys derived only from {@code (jobId, sourceIndex)}.
 *
 * <p>Bytes come exclusively from {@code ReplayArtifactWriter}, so the object this sink stores is
 * byte-identical to the file the local {@code ReplayArtifactFileSink} would have written for the
 * same parse. The sink adds no serialization of its own.</p>
 */
public final class ParserArtifactSink implements ReplayArtifactSink {

    private static final Logger LOG = LoggerFactory.getLogger(ParserArtifactSink.class);

    /** Content type of every derived artifact. */
    private static final String CONTENT_TYPE = "application/json";

    private final ObjectStorage storage;
    private final String jobId;

    public ParserArtifactSink(final ObjectStorage storage, final String jobId) {
        this.storage = Objects.requireNonNull(storage, "storage");
        final String job = Objects.requireNonNull(jobId, "jobId");
        if (job.isBlank()) {
            throw new IllegalArgumentException("jobId must not be blank");
        }
        this.jobId = job;
    }

    @Override
    public void write(final int sourceIndex, final String artifactName, final byte[] content) throws IOException {
        if (content == null) {
            throw new IllegalArgumentException("content must not be null");
        }
        final ObjectKey key = ObjectStorageKeys.tempJobObject(
                jobId, "artifacts/" + sourceIndex + "/" + artifactName);
        storage.put(key, new ByteArrayInputStream(content), content.length, CONTENT_TYPE);
        LOG.info("event=parser_worker_artifact_written jobId={} sourceIndex={} artifact={} bytes={}",
                jobId, sourceIndex, artifactName, content.length);
    }
}
