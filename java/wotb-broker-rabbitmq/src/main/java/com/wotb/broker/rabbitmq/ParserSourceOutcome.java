package com.wotb.broker.rabbitmq;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Per-source outcome inside a {@code parser.result} envelope.
 *
 * <p>An outcome is metadata only: it reports <em>that</em> a source finished and with which stable
 * status, never the parsed content or an artifact URL. The control plane reads the artifact from
 * object storage itself.</p>
 *
 * <p>{@code errorCode} is present exactly for {@link ParserSourceStatus#FAILED} and absent for
 * {@link ParserSourceStatus#READY}; {@code @JsonInclude(NON_NULL)} keeps the produced JSON property
 * set identical to the {@code required} set of {@code contracts/mq/parser-messages.json}.</p>
 *
 * @param sourceIndex zero-based source position inside the job
 * @param sourceName  display name of the uploaded replay file
 * @param status      terminal per-source status
 * @param errorCode   stable low-cardinality error code, only for {@code FAILED}
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ParserSourceOutcome(
        int sourceIndex,
        String sourceName,
        ParserSourceStatus status,
        String errorCode
) {

    public ParserSourceOutcome {
        if (sourceIndex < 0) {
            throw new IllegalArgumentException("sourceIndex must not be negative");
        }
        sourceName = ParserEnvelopeValues.text("sourceName", sourceName);
        status = ParserEnvelopeValues.reference("status", status);
        if (status == ParserSourceStatus.FAILED) {
            errorCode = ParserEnvelopeValues.text("errorCode", errorCode);
        } else if (errorCode != null) {
            throw new IllegalArgumentException("errorCode is only allowed for FAILED sources");
        }
    }
}
