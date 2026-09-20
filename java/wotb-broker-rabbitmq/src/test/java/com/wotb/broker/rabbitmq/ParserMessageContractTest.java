package com.wotb.broker.rabbitmq;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Pins {@code contracts/mq/parser-messages.json} to the codec.
 *
 * <p>The schema file would otherwise be a dead document: this test renders every envelope with the
 * production codec and asserts that the produced JSON property set is exactly the schema's
 * {@code required} set (so a field added to Java without the contract, or the reverse, fails), that
 * nested source items stay inside their declared schema, and that the schema's {@code const} version
 * is the codec's {@link ParserMessageCodec#SCHEMA_VERSION}.</p>
 */
class ParserMessageContractTest {

    private static final Path SCHEMA_PATH = Path.of("..", "..", "contracts", "mq", "parser-messages.json");

    private static final Instant FIXED_INSTANT = Instant.parse("2026-01-01T00:00:00Z");

    private final ParserMessageCodec codec = new ParserMessageCodec();

    @Test
    void requestEnvelopeMatchesSchemaRequiredSet() {
        final ParserRequestMessage message = new ParserRequestMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                "event-1",
                "job-1",
                1,
                FIXED_INSTANT,
                List.of(new ParserRequestSource(0, "a.wotbreplay"), new ParserRequestSource(1, "b.wotbreplay")));

        assertEnvelopeMatchesSchema("request", codec.encode(message));
        assertEquals(message, codec.decodeRequest(codec.encode(message)));
    }

    @Test
    void resultEnvelopeMatchesSchemaRequiredSet() {
        final ParserResultMessage message = new ParserResultMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                "event-2",
                "job-1",
                2,
                FIXED_INSTANT,
                List.of(
                        new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null),
                        new ParserSourceOutcome(
                                1, "b.wotbreplay", ParserSourceStatus.FAILED, "REPLAY_PROCESSING_FAILED")));

        assertEnvelopeMatchesSchema("result", codec.encode(message));
        assertEquals(message, codec.decodeResult(codec.encode(message)));
    }

    @Test
    void failedEnvelopeMatchesSchemaRequiredSet() {
        final ParserFailedMessage message = new ParserFailedMessage(
                ParserMessageCodec.SCHEMA_VERSION,
                "event-3",
                "job-1",
                3,
                FIXED_INSTANT,
                "PROCESSING_JOB_STORAGE_UNAVAILABLE",
                true);

        assertEnvelopeMatchesSchema("failed", codec.encode(message));
        assertEquals(message, codec.decodeFailed(codec.encode(message)));
    }

    @Test
    void schemaVersionConstantIsPinnedByTheSchema() {
        final JsonNode constant = definitions().get("schemaVersion");

        assertEquals("string", constant.get("type").asString());
        assertEquals(ParserMessageCodec.SCHEMA_VERSION, constant.get("const").asString());
    }

    @Test
    void unknownSchemaVersionFailsClosed() {
        final byte[] body = ("{\"schemaVersion\":\"2\",\"eventId\":\"e\",\"jobId\":\"job-1\",\"attempt\":1,"
                + "\"occurredAt\":\"2026-01-01T00:00:00Z\",\"sources\":[]}").getBytes(StandardCharsets.UTF_8);

        final ParserMessageCodecException failure =
                assertThrows(ParserMessageCodecException.class, () -> codec.decodeResult(body));

        assertTrue(failure.getMessage().contains("unsupported parser envelope schemaVersion"), failure.getMessage());
        assertEquals("job-1", failure.jobId().orElse(null));
        assertEquals("e", failure.eventId().orElse(null));
    }

    @Test
    void missingSchemaVersionFailsClosed() {
        final byte[] body = "{\"jobId\":\"job-1\"}".getBytes(StandardCharsets.UTF_8);

        final ParserMessageCodecException failure =
                assertThrows(ParserMessageCodecException.class, () -> codec.decodeResult(body));

        assertTrue(failure.getMessage().contains("requires a string schemaVersion"), failure.getMessage());
    }

    @Test
    void nonJsonAndNonObjectBodiesFailClosed() {
        final byte[] notJson = "parser.request".getBytes(StandardCharsets.UTF_8);
        final byte[] notObject = "[1,2,3]".getBytes(StandardCharsets.UTF_8);

        assertTrue(assertThrows(ParserMessageCodecException.class, () -> codec.decodeRequest(notJson))
                .getMessage().contains("not valid JSON"));
        assertTrue(assertThrows(ParserMessageCodecException.class, () -> codec.decodeRequest(notObject))
                .getMessage().contains("must be a JSON object"));
        assertNull(assertThrows(ParserMessageCodecException.class, () -> codec.decodeRequest(notJson))
                .jobId().orElse(null));
    }

    @Test
    void propertiesOutsideTheEnvelopeFailClosed() {
        final byte[] body = ("{\"schemaVersion\":\"1\",\"eventId\":\"e\",\"jobId\":\"job-1\",\"attempt\":1,"
                + "\"createdAt\":\"2026-01-01T00:00:00Z\",\"sources\":[],\"artifactUrl\":\"s3://bucket/key\"}")
                .getBytes(StandardCharsets.UTF_8);

        final ParserMessageCodecException failure =
                assertThrows(ParserMessageCodecException.class, () -> codec.decodeRequest(body));

        assertTrue(failure.getMessage().contains("violates the ParserRequestMessage contract"), failure.getMessage());
    }

    @Test
    void sourceOutcomeErrorCodeIsTiedToTheStatus() {
        assertThrows(IllegalArgumentException.class,
                () -> new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.FAILED, null));
        assertThrows(IllegalArgumentException.class,
                () -> new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, "REPLAY_PROCESSING_FAILED"));

        final ParserResultMessage message = new ParserResultMessage(
                ParserMessageCodec.SCHEMA_VERSION, "event-4", "job-1", 1, FIXED_INSTANT,
                List.of(new ParserSourceOutcome(0, "a.wotbreplay", ParserSourceStatus.READY, null)));
        final JsonNode produced = JsonMapper.builder().build().readTree(codec.encode(message));

        assertNull(produced.get("sources").get(0).get("errorCode"));
    }

    @Test
    void attemptMustStartAtOne() {
        assertThrows(IllegalArgumentException.class, () -> new ParserFailedMessage(
                ParserMessageCodec.SCHEMA_VERSION, "event-5", "job-1", 0, FIXED_INSTANT, "REPLAY_PROCESSING_FAILED", false));
    }

    private void assertEnvelopeMatchesSchema(final String definition, final byte[] body) {
        final JsonNode envelopeSchema = definitions().get(definition);
        final JsonNode produced = JsonMapper.builder().build().readTree(body);

        final Set<String> producedNames = new LinkedHashSet<>(produced.propertyNames());
        final Set<String> requiredNames = arrayNames(envelopeSchema.get("required"));
        assertEquals(requiredNames, producedNames, definition + " produced properties must equal its required set");
        assertTrue(objectNames(envelopeSchema.get("properties")).containsAll(producedNames),
                definition + " produced an undeclared property");

        final JsonNode sourcesProperty = envelopeSchema.get("properties").get("sources");
        if (sourcesProperty == null) {
            assertFalse(produced.has("sources"), definition + " must not produce an undeclared sources array");
            return;
        }
        final JsonNode sourceItemSchema = dereference(sourcesProperty.get("items"));
        final Set<String> sourceRequired = arrayNames(sourceItemSchema.get("required"));
        final Set<String> sourceDeclared = objectNames(sourceItemSchema.get("properties"));
        for (final JsonNode producedSource : produced.get("sources").values()) {
            final Set<String> sourceNames = new LinkedHashSet<>(producedSource.propertyNames());
            assertTrue(sourceNames.containsAll(sourceRequired), definition + " source is missing required properties");
            assertTrue(sourceDeclared.containsAll(sourceNames), definition + " source produced an undeclared property");
        }
    }

    /** Follows the single {@code #/definitions/<name>} reference form this schema uses. */
    private JsonNode dereference(final JsonNode node) {
        assertFalse(node == null, "the schema must declare the nested item schema");
        final JsonNode reference = node.get("$ref");
        if (reference == null) {
            return node;
        }
        final String target = reference.asString();
        assertTrue(target.startsWith("#/definitions/"), "unsupported schema reference: " + target);
        return definitions().get(target.substring("#/definitions/".length()));
    }

    private JsonNode definitions() {
        assertTrue(Files.exists(SCHEMA_PATH), "the parser message schema must exist at " + SCHEMA_PATH.toAbsolutePath());
        return JsonMapper.builder().build().readTree(SCHEMA_PATH).get("definitions");
    }

    private static Set<String> arrayNames(final JsonNode array) {
        final Set<String> result = new LinkedHashSet<>();
        for (final JsonNode element : array.values()) {
            result.add(element.asString());
        }
        return result;
    }

    private static Set<String> objectNames(final JsonNode object) {
        return new LinkedHashSet<>(object.propertyNames());
    }
}
