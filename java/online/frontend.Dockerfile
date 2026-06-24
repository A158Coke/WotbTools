# 多阶段: Node 构建 Vue -> nginx 提供静态 + 反代 /api
# 构建上下文为仓库根 (与 backend 一致): App.vue 通过 ../../../common 引用 map_names.json,
# 需保持仓库目录结构, 该共享 JSON 才能在构建时解析到。
FROM node:22-alpine AS build
WORKDIR /app/java/frontend
COPY java/frontend/package.json ./
# 用 npmmirror 加速(公网 npm 可能慢)
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY java/frontend/ .
# 共享地图中文名 (单一来源在仓库根 common/, 前后端共用)
COPY common/map_names.json /app/common/map_names.json
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/java/frontend/dist /usr/share/nginx/html
COPY java/online/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
