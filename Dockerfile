# 单镜像: 编译后端 (Maven) + 前端 (Node) → nginx + JRE 运行时
# 构建上下文为仓库根 (需要 common/*.json + java/)
FROM maven:3.9-eclipse-temurin-21 AS backend-build
WORKDIR /build
COPY common/tankopedia.json common/tankopedia.json
COPY common/rating.json common/rating.json
COPY common/map_names.json common/map_names.json
COPY java/pom.xml java/settings-docker.xml java/
COPY java/wotb-core/pom.xml java/wotb-core/pom.xml
COPY java/wotb-web/pom.xml java/wotb-web/pom.xml
WORKDIR /build/java
RUN mvn -s settings-docker.xml -pl wotb-core,wotb-web -am -DskipTests dependency:go-offline -q || true
WORKDIR /build
COPY java/wotb-core/src java/wotb-core/src
COPY java/wotb-web/src java/wotb-web/src
WORKDIR /build/java
RUN mvn -s settings-docker.xml -pl wotb-core,wotb-web -am -DskipTests clean package

FROM node:22-alpine AS frontend-build
WORKDIR /app/java/frontend
COPY java/frontend/package.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY java/frontend/ .
COPY common/map_names.json /app/common/map_names.json
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache openjdk21-jre-headless
COPY --from=backend-build /build/java/wotb-web/target/wotb-web.jar /app/app.jar
COPY --from=frontend-build /app/java/frontend/dist /usr/share/nginx/html
COPY homepage /homepage
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -e
nginx                       # 启动失败则 set -e 让容器快速失败暴露问题
exec java -jar /app/app.jar # PID 1; jar 退出即容器退出
EOF
RUN chmod +x /entrypoint.sh

EXPOSE 80
CMD ["/entrypoint.sh"]
