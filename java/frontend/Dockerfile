# 多阶段: Node 构建 Vue -> nginx 提供静态 + 反代 /api
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
# 用 npmmirror 加速(公网 npm 可能慢)
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
