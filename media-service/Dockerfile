# ========================
# Dockerfile: Media Service
# Build context phải là backend/ để truy cập shared/
# Runtime cần ffmpeg vì video-service có HLS processing
# ========================

FROM node:20-alpine AS builder

WORKDIR /build

COPY shared/package*.json ./shared/
WORKDIR /build/shared
RUN npm ci
COPY shared/tsconfig.json ./
COPY shared/src ./src
RUN npm run build

WORKDIR /build/service
COPY media-service/package*.json ./
RUN sed -i 's|"file:../shared"|"file:/build/shared"|' package.json
RUN npm install

COPY media-service/tsconfig.json ./
COPY media-service/src ./src
RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY --from=builder /build/shared /app/shared

COPY media-service/package*.json ./
RUN sed -i 's|"file:../shared"|"file:/app/shared"|' package.json
RUN npm install --omit=dev

COPY --from=builder /build/service/dist ./dist

EXPOSE 5003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5003/health || exit 1

CMD ["node", "dist/index.js"]
