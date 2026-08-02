package com.wotb.web.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * 为每个 HTTP 请求生成或继承 {@code requestId}：
 * <ul>
 *   <li>请求头 {@code X-Request-ID} 已存在（网关/客户端传入）则沿用，否则生成 UUID。</li>
 *   <li>写入 SLF4J MDC（key {@code requestId}），使结构化日志自动携带该字段。</li>
 *   <li>响应头回写 {@code X-Request-ID}，便于前端与后端日志关联。</li>
 * </ul>
 * MDC 在 finally 中清理，避免线程池复用导致串扰。
 *
 * <p>顺序必须早于 Spring Security 过滤器链（{@code SecurityProperties.DEFAULT_FILTER_ORDER = -100}），
 * 否则 401/403 等安全拒绝响应在进入本过滤器前就已返回，无法带上 {@code X-Request-ID}。
 * 本过滤器不向 {@code SecurityFilterChain} 手动注册，仅作为普通 Servlet 过滤器按此顺序执行一次，
 * 避免重复注册。</p>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-ID";
    public static final String MDC_KEY = "requestId";

    @Override
    protected void doFilterInternal(
            final HttpServletRequest request,
            final HttpServletResponse response,
            final FilterChain filterChain) throws ServletException, IOException {

        String requestId = request.getHeader(HEADER);
        if (requestId == null || requestId.isBlank()) {
            requestId = UUID.randomUUID().toString();
        } else {
            // 限制长度并去掉不可见字符，避免日志/响应头注入
            requestId = requestId.trim().substring(0, Math.min(requestId.trim().length(), 128));
        }

        MDC.put(MDC_KEY, requestId);
        response.setHeader(HEADER, requestId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }
}
