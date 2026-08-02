# Rewrite AiReplayAnalysisServiceUpstreamMetricsTest with fixed handleRequest + lazy-meter find()
path = 'java/wotb-web/src/test/java/com/wotb/web/replay/ai/AiReplayAnalysisServiceUpstreamMetricsTest.java'
with open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read()

# handleRequest: add Content-Type + try/finally close
old_handler = '''    private void handleRequest(final HttpExchange exchange) throws IOException {
        requestBodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        final byte[] bytes = SUCCESS_RESPONSE.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(responseStatus, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }'''
new_handler = '''    private void handleRequest(final HttpExchange exchange) throws IOException {
        requestBodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        final byte[] bytes = SUCCESS_RESPONSE.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        try {
            exchange.sendResponseHeaders(responseStatus, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }'''
assert old_handler in text, 'handleRequest block not found'
text = text.replace(old_handler, new_handler)

# rejected assertions: registry.get -> registry.find (lazy meters)
old_rej = '''        assertTrue(requestBodies.isEmpty(), "rejected request must not reach upstream");
        assertEquals(0L, registry.get("wotb_ai_upstream_requests_total").counter().count(),
                "rejected request must not increment upstream requests");
        assertEquals(0L, registry.get("wotb_ai_upstream_duration_seconds").timer().count(),
                "rejected request must not record upstream duration");'''
new_rej = '''        assertTrue(requestBodies.isEmpty(), "rejected request must not reach upstream");
        // counter/timer 懒注册：meter 不存在即从未计数
        assertEquals(null, registry.find("wotb_ai_upstream_requests_total").counter(),
                "rejected request must not create upstream requests meter");
        assertEquals(null, registry.find("wotb_ai_upstream_duration_seconds").timer(),
                "rejected request must not create upstream duration meter");'''
assert old_rej in text, 'rejected block not found'
text = text.replace(old_rej, new_rej)

# success assertions: registry.get -> registry.find
old_succ = '''        assertEquals(1, requestBodies.size(), "exactly one upstream call expected");
        assertEquals(1L, registry.get("wotb_ai_upstream_requests_total").counter().count(),
                "one attempt must increment requests exactly once");
        assertEquals(1L, registry.get("wotb_ai_upstream_duration_seconds").timer().count(),
                "successful attempt must record duration");'''
new_succ = '''        assertEquals(1, requestBodies.size(), "exactly one upstream call expected");
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total").counter().count(),
                "one attempt must increment requests exactly once");
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds").timer().count(),
                "successful attempt must record duration");'''
assert old_succ in text, 'success block not found'
text = text.replace(old_succ, new_succ)

# failure assertions: registry.get -> registry.find
old_fail = '''        assertEquals(1, requestBodies.size(), "upstream must be attempted once");
        assertEquals(1L, registry.get("wotb_ai_upstream_requests_total").counter().count(),
                "failed attempt still counts as one request");
        assertEquals(1L, registry.get("wotb_ai_upstream_duration_seconds").timer().count(),
                "timer must stop on failure too");
        assertTrue(registry.get("wotb_ai_upstream_errors_total").tag("type", "AI_AUTHENTICATION_ERROR")
                        .counter().count() >= 1L,
                "failure must record an error classification");'''
new_fail = '''        assertEquals(1, requestBodies.size(), "upstream must be attempted once");
        assertEquals(1L, registry.find("wotb_ai_upstream_requests_total").counter().count(),
                "failed attempt still counts as one request");
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds").timer().count(),
                "timer must stop on failure too");
        assertTrue(registry.find("wotb_ai_upstream_errors_total").tag("type", "AI_AUTHENTICATION_ERROR")
                        .counter().count() >= 1L,
                "failure must record an error classification");'''
assert old_fail in text, 'failure block not found'
text = text.replace(old_fail, new_fail)

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(text)

with open(path, 'r', encoding='utf-8') as f:
    check = f.read()
print('Content-Type header:', check.count('Content-Type'))
print('find() refs:', check.count('registry.find'))
print('get() refs:', check.count('registry.get'))
print('try/finally close:', check.count('finally {'))
