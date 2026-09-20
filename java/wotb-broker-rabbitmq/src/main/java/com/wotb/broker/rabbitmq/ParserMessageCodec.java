package com.wotb.broker.rabbitmq;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Encodes and decodes the three parser wire envelopes of protocol version 1.
 *
 * <p>This class is the single wire authority for the AMQP payload shape. The Java records next to
 * it describe the same shape for JVM callers, and {@code contracts/mq/parser-messages.json}
 * describes it for reviewers and other runtimes; a test pins the two together by comparing the
 * produced JSON property set against the schema's {@code required} set.</p>
 *
 * <p><strong>Fail closed.</strong> Missing or unknown {@code schemaVersion}, malformed JSON, a body
 * that is not an object, and any property outside the reviewed envelope (unknown properties stay an
 * error) are rejected with {@link ParserMessageCodecException}. There is no lenient fallback and no
 * silent downgrade: a message the codec cannot fully understand must reach {@code wotb.parser.dlq}
 * for an operator instead of being half-applied.</p>
 */
public final class ParserMessageCodec {

    /**
     * Protocol version of every envelope in this class. A receiver must reject any other value;
     * the JSON Schema pins the same constant through its {@code const}.
     */
    public static final String SCHEMA_VERSION = "1";

    private static final String SCHEMA_VERSION_FIELD = "schemaVersion";
    private static final String JOB_ID_FIELD = "jobId";
    private static final String EVENT_ID_FIELD = "eventId";

    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    /** Serializes a request envelope as UTF-8 JSON. */
    public byte[] encode(final ParserRequestMessage message) {
        return encodeValue(ParserEnvelopeValues.reference("message", message));
    }

    /** Serializes a result envelope as UTF-8 JSON. */
    public byte[] encode(final ParserResultMessage message) {
        return encodeValue(ParserEnvelopeValues.reference("message", message));
    }

    /** Serializes a failed envelope as UTF-8 JSON. */
    public byte[] encode(final ParserFailedMessage message) {
        return encodeValue(ParserEnvelopeValues.reference("message", message));
    }

    /** Decodes a {@code parser.request} body, or throws {@link ParserMessageCodecException}. */
    public ParserRequestMessage decodeRequest(final byte[] body) {
        return decode(body, ParserRequestMessage.class);
    }

    /** Decodes a {@code parser.result} body, or throws {@link ParserMessageCodecException}. */
    public ParserResultMessage decodeResult(final byte[] body) {
        return decode(body, ParserResultMessage.class);
    }

    /** Decodes a {@code parser.failed} body, or throws {@link ParserMessageCodecException}. */
    public ParserFailedMessage decodeFailed(final byte[] body) {
        return decode(body, ParserFailedMessage.class);
    }

    /**
     * Best-effort {@code jobId} of a body, used only for diagnostics of an undecodable message.
     * It never influences message handling: the consumer's decision stays "reject to DLQ".
     */
    static String peekJobId(final byte[] body) {
        return peekText(body, JOB_ID_FIELD);
    }

    /** Best-effort {@code eventId} of a body, used only for diagnostics. */
    static String peekEventId(final byte[] body) {
        return peekText(body, EVENT_ID_FIELD);
    }

    private byte[] encodeValue(final Object message) {
        try {
            return MAPPER.writeValueAsBytes(message);
        } catch (final JacksonException e) {
            throw new IllegalStateException("parser envelope is not serializable: " + message.getClass(), e);
        }
    }

    private <T> T decode(final byte[] body, final Class<T> type) {
        if (body == null || body.length == 0) {
            throw new ParserMessageCodecException("parser envelope body must not be empty", null, null, null);
        }
        final JsonNode envelope = readObject(body);
        final JsonNode version = envelope.get(SCHEMA_VERSION_FIELD);
        if (version == null || !version.isString()) {
            throw new ParserMessageCodecException(
                    "parser envelope requires a string " + SCHEMA_VERSION_FIELD, peekJobId(body), peekEventId(body), null);
        }
        if (!SCHEMA_VERSION.equals(version.asString())) {
            throw new ParserMessageCodecException(
                    "unsupported parser envelope " + SCHEMA_VERSION_FIELD + ": " + version.asString(),
                    peekJobId(body), peekEventId(body), null);
        }
        try {
            return MAPPER.readValue(body, type);
        } catch (final JacksonException | IllegalArgumentException e) {
            throw new ParserMessageCodecException(
                    "parser envelope violates the " + type.getSimpleName() + " contract",
                    peekJobId(body), peekEventId(body), e);
        }
    }

    private JsonNode readObject(final byte[] body) {
        final JsonNode envelope;
        try {
            envelope = MAPPER.readTree(body);
        } catch (final JacksonException e) {
            throw new ParserMessageCodecException("parser envelope is not valid JSON", null, null, e);
        }
        if (envelope == null || !envelope.isObject()) {
            throw new ParserMessageCodecException("parser envelope must be a JSON object", null, null, null);
        }
        return envelope;
    }

    private static String peekText(final byte[] body, final String field) {
        if (body == null || body.length == 0) {
            return null;
        }
        try {
            final JsonNode node = MAPPER.readTree(body);
            if (node == null || !node.isObject()) {
                return null;
            }
            final JsonNode value = node.get(field);
            return value != null && value.isString() ? value.asString() : null;
        } catch (final JacksonException ignored) {
            // Unparsable body: no identity is the honest answer.
            return null;
        }
    }
}
