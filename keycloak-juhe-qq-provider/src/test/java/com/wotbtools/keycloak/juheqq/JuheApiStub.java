package com.wotbtools.keycloak.juheqq;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Juhe 聚合登录 API 本地 stub：返回可配置 body/status，记录收到的 raw query。 */
final class JuheApiStub implements AutoCloseable {

    private final HttpServer server;
    private volatile String responseBody = "{}";
    private volatile int responseStatus = 200;
    private final List<String> requestQueries = new CopyOnWriteArrayList<>();

    private JuheApiStub(final HttpServer server) {
        this.server = server;
    }

    static JuheApiStub start() throws IOException {
        final HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        final JuheApiStub stub = new JuheApiStub(server);
        server.createContext("/", exchange -> {
            final String query = exchange.getRequestURI().getRawQuery() == null
                    ? "" : exchange.getRequestURI().getRawQuery();
            stub.requestQueries.add(query);
            final byte[] bytes = stub.responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(stub.responseStatus, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
        server.start();
        return stub;
    }

    /** 登录/回调共用的 base URL（指向本 stub 的 connect.php）。 */
    String base() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/connect.php";
    }

    void respond(final String body) {
        responseBody = body;
        responseStatus = 200;
    }

    void respondStatus(final int status, final String body) {
        responseStatus = status;
        responseBody = body;
    }

    long requestsWith(final String act) {
        return requestQueries.stream().filter(q -> q.contains("act=" + act)).count();
    }

    String lastQuery() {
        return requestQueries.isEmpty() ? "" : requestQueries.get(requestQueries.size() - 1);
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
