package com.wotb.parserworker.worker;

import com.wotb.core.model.Battle;
import java.util.List;
import java.util.Objects;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Canonical dataset of exactly one source, persisted as
 * {@code temp/jobs/<jobId>/result/source-<sourceIndex>.json}.
 *
 * <p><b>Shape.</b> It is the per-source projection of the JVM-side {@code ProcessedDataset} the
 * local control plane holds in memory while a job is READY: {@code battles} carries the existing
 * Jackson shape of {@code Battle}, plus the same {@code battleSourceNames} /
 * {@code battleSourceIds} / {@code duplicates} / {@code failures} / {@code league} /
 * {@code leagueUnavailableCode} fields. A distributed consumer reads one file per source and joins
 * them by {@code sourceIndex}; the worker is stateless per delivery, so it cannot aggregate a whole
 * job by itself.</p>
 *
 * <p>{@code schemaVersion} lets that consumer reject an artifact written by a different protocol
 * revision instead of half-applying it.</p>
 *
 * @param schemaVersion         dataset schema version, exactly {@link #SCHEMA_VERSION}
 * @param sourceIndex           zero-based source position inside the job
 * @param sourceName            display name of the uploaded replay file
 * @param battles               canonical parsed battles of this source (exactly one when READY)
 * @param battleSourceNames     display names aligned with {@code battles}
 * @param battleSourceIds       stable ids aligned with {@code battles} (the input object key)
 * @param duplicates            duplicate source names detected while processing this source
 * @param failures              {@code [sourceName, errorCode]} pairs of the sources this run rejected
 * @param league                league rating batch, or {@code null} for a standard battle
 * @param leagueUnavailableCode stable code when a league batch could not be built
 */
public record ParserSourceDataset(
        String schemaVersion,
        int sourceIndex,
        String sourceName,
        List<Battle> battles,
        List<String> battleSourceNames,
        List<String> battleSourceIds,
        List<String[]> duplicates,
        List<String[]> failures,
        Object league,
        String leagueUnavailableCode
) {

    /** Version of the persisted per-source dataset shape. */
    public static final String SCHEMA_VERSION = "1";

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    public ParserSourceDataset {
        schemaVersion = requireText("schemaVersion", schemaVersion);
        if (sourceIndex < 0) {
            throw new IllegalArgumentException("sourceIndex must not be negative");
        }
        sourceName = requireText("sourceName", sourceName);
        Objects.requireNonNull(battles, "battles");
        battles = List.copyOf(battles);
        battleSourceNames = battleSourceNames == null ? List.of() : List.copyOf(battleSourceNames);
        battleSourceIds = battleSourceIds == null ? List.of() : List.copyOf(battleSourceIds);
        duplicates = duplicates == null ? List.of() : List.copyOf(duplicates);
        failures = failures == null ? List.of() : List.copyOf(failures);
    }

    /** Serializes the dataset as UTF-8 JSON bytes (deterministic for one parsed battle). */
    public byte[] toBytes() {
        return MAPPER.writeValueAsBytes(this);
    }

    private static String requireText(final String name, final String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
