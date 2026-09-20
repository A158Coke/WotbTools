package com.wotb.broker.rabbitmq;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Immutable per-source metadata of a {@code parser.request} envelope.
 *
 * <p>It is the wire twin of {@code com.wotb.contracts.ReplayProcessingSource} and deliberately
 * carries the same two fields: identity only, never a path or a URL.</p>
 *
 * @param sourceIndex zero-based source position inside the job
 * @param sourceName  display name of the uploaded replay file
 */
public record ParserRequestSource(int sourceIndex, String sourceName) {

    public ParserRequestSource {
        if (sourceIndex < 0) {
            throw new IllegalArgumentException("sourceIndex must not be negative");
        }
        sourceName = ParserEnvelopeValues.text("sourceName", sourceName);
    }

    /**
     * Copies a source list, rejecting {@code null} entries and duplicate indexes so that a decoded
     * envelope can never describe an ambiguous job.
     */
    static List<ParserRequestSource> list(final List<ParserRequestSource> sources) {
        final List<ParserRequestSource> copy = ParserEnvelopeValues.reference("sources", sources);
        final List<ParserRequestSource> result = List.copyOf(copy);
        final Set<Integer> indexes = new HashSet<>();
        for (final ParserRequestSource source : result) {
            ParserEnvelopeValues.reference("sources[]", source);
            if (!indexes.add(source.sourceIndex())) {
                throw new IllegalArgumentException("sources must not contain duplicate sourceIndex");
            }
        }
        return result;
    }
}
