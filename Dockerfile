# 前端构建
FROM node:24 AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 后端编译
FROM node:24 AS serverbuild
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY server/ ./
RUN npm run build

# 运行时
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=webbuild /app/web/dist ./web/dist
COPY --from=serverbuild /app/server/dist ./server/dist
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
WORKDIR /app/server
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
