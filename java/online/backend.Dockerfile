# 多阶段构建: 用 Aliyun 镜像编译 (Maven Central 被网络拦截)
# 构建上下文为仓库根: 需要 common/tankopedia.json (车辆库单一来源) 与 java/。
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
# 共享资源 (wotb-core 通过 ../../common 引用): 车辆库 + 评分配置 + 地图中文名
COPY common/tankopedia.json common/tankopedia.json
COPY common/rating.json common/rating.json
COPY common/map_names.json common/map_names.json
# 先拷 pom 拉依赖 (利用缓存)
COPY java/pom.xml java/settings-docker.xml java/
COPY java/wotb-core/pom.xml java/wotb-core/pom.xml
COPY java/wotb-web/pom.xml java/wotb-web/pom.xml
WORKDIR /build/java
RUN mvn -s settings-docker.xml -pl wotb-core,wotb-web -am -DskipTests dependency:go-offline -q || true
# 再拷源码并打包
WORKDIR /build
COPY java/wotb-core/src java/wotb-core/src
COPY java/wotb-web/src java/wotb-web/src
WORKDIR /build/java
RUN mvn -s settings-docker.xml -pl wotb-core,wotb-web -am -DskipTests clean package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/java/wotb-web/target/wotb-web.jar app.jar
EXPOSE 8087
ENTRYPOINT ["java", "-jar", "app.jar"]
