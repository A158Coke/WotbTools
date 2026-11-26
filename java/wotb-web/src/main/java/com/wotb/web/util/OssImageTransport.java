package com.wotb.web.util;

import com.aliyun.sdk.service.oss2.transport.BinaryData;
import com.aliyun.sdk.service.oss2.transport.HttpClient;
import com.aliyun.sdk.service.oss2.transport.RequestContext;
import com.aliyun.sdk.service.oss2.transport.RequestException;
import com.aliyun.sdk.service.oss2.transport.RequestMessage;
import com.aliyun.sdk.service.oss2.transport.ResponseMessage;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.HttpDelete;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPut;
import org.apache.http.client.methods.HttpRequestBase;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;

import java.io.IOException;
import java.util.TreeMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** OSS signs and interprets the requests. Abort the same HTTP exchange across pool wait, send and body read. */
final class OssImageTransport implements HttpClient, AutoCloseable {
    static final ScopedValue<Integer> READ_LIMIT = ScopedValue.newInstance();
    private static final int CONTROL_BODY_LIMIT = 64 * 1024;

    private final CloseableHttpClient http;
    private final ExecutorService exchanges = Executors.newVirtualThreadPerTaskExecutor();
    private final int deadlineMs;

    OssImageTransport(final int connections, final int deadlineMs) {
        this.deadlineMs = deadlineMs;
        final RequestConfig config = RequestConfig.custom().setConnectTimeout(5_000)
                .setConnectionRequestTimeout(5_000).setSocketTimeout(15_000).build();
        http = HttpClients.custom().setDefaultRequestConfig(config).setMaxConnTotal(connections)
                .setMaxConnPerRoute(connections).disableRedirectHandling().disableAutomaticRetries()
                .disableContentCompression().disableCookieManagement().build();
    }

    @Override public ResponseMessage send(final RequestMessage message, final RequestContext context) {
        final HttpRequestBase request = switch (message.method()) {
            case "GET" -> new HttpGet(message.uri());
            case "DELETE" -> new HttpDelete(message.uri());
            case "PUT" -> {
                final HttpPut put = new HttpPut(message.uri());
                put.setEntity(new ByteArrayEntity(message.body().toBytes()));
                yield put;
            }
            default -> throw new IllegalArgumentException("Unsupported image storage operation");
        };
        message.headers().forEach((name, value) -> {
            // HttpClient derives framing from the repeatable entity.
            if (!"Content-Length".equalsIgnoreCase(name)) { request.setHeader(name, value); }
        });
        final int dataLimit = request instanceof HttpGet ? READ_LIMIT.get() : CONTROL_BODY_LIMIT;
        final var exchange = exchanges.submit(() -> execute(message, request, dataLimit));
        try {
            return exchange.get(deadlineMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException | InterruptedException e) {
            // Abort the actual socket or pool waiter, including while sending PUT or consuming a slow body.
            request.abort();
            exchange.cancel(true);
            if (e instanceof InterruptedException) { Thread.currentThread().interrupt(); }
            throw new RequestException("OSS image request cancelled", e);
        } catch (ExecutionException e) {
            throw new RequestException("OSS image transport failed", e.getCause());
        }
    }

    private ResponseMessage execute(final RequestMessage message, final HttpRequestBase request,
                                    final int dataLimit) throws IOException {
        try (var response = http.execute(request)) {
            final int status = response.getStatusLine().getStatusCode();
            if (request instanceof HttpGet && status >= 200 && status < 300 && status != 200) {
                request.abort();
                throw new IOException("Expected complete OSS object");
            }
            final var headers = new TreeMap<String, String>(String.CASE_INSENSITIVE_ORDER);
            for (var h : response.getAllHeaders()) { headers.put(h.getName(), h.getValue()); }
            final var result = ResponseMessage.newBuilder().request(message).statusCode(status).headers(headers);
            if (response.getEntity() != null) {
                final int limit = status == 200 ? dataLimit : CONTROL_BODY_LIMIT;
                final byte[] body = response.getEntity().getContent().readNBytes(limit + 1);
                if (body.length > limit) {
                    request.abort();
                    throw new IOException("Oversized OSS response");
                }
                result.body(BinaryData.fromBytes(body));
            }
            return result.build();
        }
    }

    @Override public void close() throws IOException {
        try { http.close(); }
        finally { exchanges.close(); }
    }
}
