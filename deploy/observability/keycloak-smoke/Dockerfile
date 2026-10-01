# A disposable derivative of the real production image; the hook is never shipped.
ARG PRODUCTION_IMAGE=wotbtools-keycloak:observability-production
FROM ${PRODUCTION_IMAGE} AS dependencies
FROM eclipse-temurin:21-jdk AS compile
COPY --from=dependencies /opt/keycloak/lib/lib/main/ /keycloak-libs/
COPY --from=dependencies /opt/keycloak/providers/keycloak-qq-provider.jar /keycloak-libs/
COPY ObservabilitySmokeFactory.java /src/ObservabilitySmokeFactory.java
RUN mkdir -p /classes/META-INF/services && \
    javac -cp '/keycloak-libs/*' -d /classes /src/ObservabilitySmokeFactory.java && \
    echo io.github.trashblazer.keycloak.social.qq.ObservabilitySmokeFactory > /classes/META-INF/services/org.keycloak.events.EventListenerProviderFactory && \
    jar cf /smoke.jar -C /classes .
FROM ${PRODUCTION_IMAGE}
COPY --from=compile /smoke.jar /opt/keycloak/providers/observability-smoke.jar
RUN /opt/keycloak/bin/kc.sh build --db=postgres
