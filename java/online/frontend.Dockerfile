# 多阶段: Node 构建 Vue -> nginx 提供静态 + 反代 /api
# 构建上下文为 java/ (需要 frontend/ 源码与 online/nginx.conf)
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json ./
# 用 npmmirror 加速(公网 npm 可能慢)
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY frontend/ .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY online/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
