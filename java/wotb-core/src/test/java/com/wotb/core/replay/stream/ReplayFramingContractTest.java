package com.wotb.core.replay.stream;

import com.wotb.core.parse.ReplayStreamHeader;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * strict-framing / no-resync API contract.
 *
 * <p>PR147/PR162 made strict contiguous framing the production contract: the reader never byte-by-byte
 * resyncs, never reports a resync/recovered/skipped-byte model, and the single-value
 * {@code PacketReadStatus} is gone. This test pins those guarantees so a future refactor cannot silently
 * reintroduce a resync/skip/read-status API. The header parser is single-sourced at {@code ReplayStreamHeader.parse}.</p>
 */
class ReplayFramingContractTest {

    private static boolean anyName(final String[] names, final String regex) {
        return Arrays.stream(names).anyMatch(n -> n.matches(regex));
    }

    @Test
    void diagnosticsCarriesNoResyncOrSkippedBytesModel() {
        final String[] fields = Arrays.stream(ReplayStreamDiagnostics.class.getDeclaredFields())
                .map(Field::getName).toArray(String[]::new);
        assertTrue(!anyName(fields, "(?i).*(resync|skipped|recover|readstatus).*"),
                "ReplayStreamDiagnostics must not expose resync/skipped-byte/recovered/read-status fields: "
                        + String.join(", ", fields));
        final String[] methods = Arrays.stream(ReplayStreamDiagnostics.class.getDeclaredMethods())
                .map(Method::getName).toArray(String[]::new);
        assertTrue(!anyName(methods, "(?i).*(resync|skipped|recover|readstatus).*"),
                "ReplayStreamDiagnostics must not expose resync/skipped-byte/recovered/read-status methods");
    }

    @Test
    void packetStreamReaderHasNoResyncOrSkipApi() {
        final String[] methods = Arrays.stream(ReplayPacketStreamReader.class.getDeclaredMethods())
                .map(Method::getName).toArray(String[]::new);
        assertTrue(!anyName(methods, "(?i).*(resync|skipped|recover).*"),
                "ReplayPacketStreamReader must not expose resync/skip/recover APIs: "
                        + String.join(", ", methods));
    }

    @Test
    void packetReadStatusClassIsGone() {
        assertThrows(ClassNotFoundException.class,
                () -> Class.forName("com.wotb.core.replay.stream.PacketReadStatus"),
                "single-value PacketReadStatus must be deleted (no readStatus resync model)");
    }

    @Test
    void singleHeaderParserIsReplayStreamHeaderParse() throws Exception {
        // Single source of the data.wotreplay header parse: ReplayStreamHeader.parse.
        final Method parse = ReplayStreamHeader.class.getDeclaredMethod("parse", byte[].class);
        assertTrue(java.lang.reflect.Modifier.isPublic(parse.getModifiers()),
                "ReplayStreamHeader.parse must be the public single header parser entry");
    }
}
