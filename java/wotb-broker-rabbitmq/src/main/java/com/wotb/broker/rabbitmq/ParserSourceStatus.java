package com.wotb.broker.rabbitmq;

/**
 * Terminal per-source outcome status of a {@code parser.result} envelope.
 *
 * <p>The two values mirror the authoritative PostgreSQL source states {@code READY} / {@code FAILED}
 * ({@code ReplayProcessingJob}). They are a wire projection of the control plane's state machine,
 * never a second state authority: the control plane decides what a reported status means for the
 * job and ignores it when the report is stale.</p>
 */
public enum ParserSourceStatus {

    /** The worker produced the canonical result artifact for this source. */
    READY,

    /** The worker could not process this source; {@code errorCode} is required. */
    FAILED
}
