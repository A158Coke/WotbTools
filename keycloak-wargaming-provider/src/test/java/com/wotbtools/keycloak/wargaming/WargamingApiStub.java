package com.wotbtools.keycloak.wargaming;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * WG API 本地 stub：按路径返回可配置 JSON，记录收到的请求路径。
 */
final class WargamingApiStub implements AutoCloseable {

    private final HttpServer server;
    final Map<String, String> responses = new ConcurrentHashMap<>();
    final List<String> requests = new CopyOnWriteArrayList<>();
    final Map<String, String> lastQueryByPath = new ConcurrentHashMap<>();
    final List<String> requestBodies = new CopyOnWriteArrayList<>();
    private volatile String lastRequestQuery = "";

    private WargamingApiStub(final HttpServer server) {
        this.server = server;
    }

    static WargamingApiStub start() throws IOException {
        final HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        final WargamingApiStub stub = new WargamingApiStub(server);
        server.createContext("/", exchange -> {
            final String path = exchange.getRequestURI().getPath();
            stub.requests.add(path);
            final String query = exchange.getRequestURI().getRawQuery() == null
                    ? "" : exchange.getRequestURI().getRawQuery();
            stub.lastRequestQuery = query;
            stub.lastQueryByPath.put(path, query);
            final byte[] bodyBytes = exchange.getRequestBody().readAllBytes();
            stub.requestBodies.add(new String(bodyBytes, StandardCharsets.UTF_8));
            final String body = stub.responses.getOrDefault(path, "{\"status\":\"error\"}");
            final byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
        server.start();
        return stub;
    }

    URI authBase() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/wot/auth/");
    }

    URI accountBase() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/wotb/account/");
    }

    /**
     * 最近一次请求的原始 query string（用于断言参数完整性）。
     */
    String requestQuery() {
        return lastRequestQuery;
    }

    long logoutCalls() {
        return requests.stream().filter("/wot/auth/logout/"::equals).count();
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
