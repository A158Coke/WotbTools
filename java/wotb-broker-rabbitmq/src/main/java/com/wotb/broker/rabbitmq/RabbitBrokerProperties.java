package com.wotb.broker.rabbitmq;

/**
 * Immutable AMQP connection settings for this application identity.
 *
 * <p>The values come from the deployment process environment (GitHub Secrets/Variables forwarded
 * into the container environment); the concrete variable <em>names</em> belong to the consumer
 * wiring (PR D/E) and are deliberately not fixed here, so this module cannot become a second source
 * of truth for the deployment contract.</p>
 *
 * <p>{@code toString()} is hand-written and never renders {@code password}: this record is exactly
 * the kind of value that ends up in a log line through an accidental string concatenation or a
 * debugger dump, and a leaked broker credential grants publish/consume on the shared vhost.</p>
 *
 * @param host     broker host name or address
 * @param port     AMQP port, 1-65535
 * @param vhost    virtual host, for example {@code /wotbtools}
 * @param username application identity name
 * @param password application identity password
 * @param prefetch consumer prefetch budget, the worker's only concurrency control
 */
public record RabbitBrokerProperties(
        String host,
        int port,
        String vhost,
        String username,
        String password,
        int prefetch
) {

    public RabbitBrokerProperties {
        host = ParserEnvelopeValues.text("host", host);
        vhost = ParserEnvelopeValues.text("vhost", vhost);
        username = ParserEnvelopeValues.text("username", username);
        password = ParserEnvelopeValues.text("password", password);
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("port must be between 1 and 65535: " + port);
        }
        if (prefetch < 1) {
            throw new IllegalArgumentException("prefetch must be at least 1: " + prefetch);
        }
    }

    @Override
    public String toString() {
        return "RabbitBrokerProperties[host=" + host
                + ", port=" + port
                + ", vhost=" + vhost
                + ", username=" + username
                + ", password=***"
                + ", prefetch=" + prefetch
                + "]";
    }
}
