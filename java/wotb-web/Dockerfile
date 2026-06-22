# 多阶段构建: 用 Aliyun 镜像编译 (Maven Central 被网络拦截)
# 构建上下文应为 java/ 目录 (需要 wotb-core + wotb-web)
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml settings-docker.xml ./
COPY wotb-core/pom.xml wotb-core/pom.xml
COPY wotb-web/pom.xml wotb-web/pom.xml
# 先拉依赖(利用缓存)
RUN mvn -s settings-docker.xml -pl wotb-core,wotb-web -am -DskipTests dependency:go-offline -q || true
COPY wotb-core/src wotb-core/src
COPY wotb-web/src wotb-web/src
RUN mvn -s settings-docker.xml -pl wotb-core,wotb-web -am -DskipTests clean package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/wotb-web/target/wotb-web.jar app.jar
EXPOSE 8087
ENTRYPOINT ["java", "-jar", "app.jar"]
