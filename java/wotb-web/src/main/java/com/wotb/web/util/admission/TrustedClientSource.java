package com.wotb.web.util.admission;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.web.util.matcher.IpAddressMatcher;

import java.net.InetAddress;
import java.util.Arrays;
import java.util.List;

/** 只接受已信任反向代理覆盖的单地址 X-Real-IP，不读取客户端 XFF 链。 */
public final class TrustedClientSource {
    private final List<IpAddressMatcher> proxies;

    public TrustedClientSource(final String trustedProxies) {
        proxies = Arrays.stream(trustedProxies.split(",")).map(String::trim)
                .filter(value -> !value.isEmpty()).map(IpAddressMatcher::new).toList();
    }

    public String resolve(final HttpServletRequest request) {
        final String peer = request.getRemoteAddr();
        if (proxies.stream().noneMatch(proxy -> proxy.matches(peer))) { return peer; }
        final var headers = request.getHeaders("X-Real-IP");
        if (headers == null || !headers.hasMoreElements()) { return peer; }
        final String address = headers.nextElement();
        if (headers.hasMoreElements() || address.contains("%")) { return peer; }
        try {
            return InetAddress.ofLiteral(address).getHostAddress();
        } catch (final IllegalArgumentException exception) {
            return peer;
        }
    }
}
