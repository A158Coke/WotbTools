package com.wotb.ai.gateway;

import java.util.ArrayList;
import java.util.List;

final class AiGatewayStreamChunker {
    static final int CHUNK_SPLIT_THRESHOLD = 512;
    static final int CHUNK_MAX_PIECE = 128;
    static final int CHUNK_MAX_PIECES = 512;
    static final long CHUNK_PAUSE_MILLIS = 20L;

    private AiGatewayStreamChunker() { }

    static List<String> splitChunks(final String text, final int maxPiece) {
        if (text == null || text.isEmpty()) {
            return List.of();
        }
        final int base = Math.max(1, maxPiece);
        final int effectiveMax = Math.max(
                base, (int) Math.ceil((double) text.length() / CHUNK_MAX_PIECES));
        final List<String> pieces = new ArrayList<>();
        int start = 0;
        while (start < text.length()) {
            final int end = Math.min(text.length(), start + effectiveMax);
            int cut = end;
            if (end < text.length()) {
                for (int i = end - 1; i > start; i--) {
                    final char c = text.charAt(i);
                    if (c == '。' || c == '！' || c == '？' || c == '；'
                            || c == '\n' || c == '.' || c == '!' || c == '?' || c == ';') {
                        cut = i + 1;
                        break;
                    }
                }
            }
            pieces.add(text.substring(start, cut));
            start = cut;
        }
        return pieces;
    }

    static void pauseBetweenPieces() {
        try {
            Thread.sleep(CHUNK_PAUSE_MILLIS);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
