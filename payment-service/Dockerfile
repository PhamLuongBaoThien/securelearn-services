# Dockerfile: Payment Service
# Build context phải là backend/ (không phải payment-service/)

FROM node:20-alpine AS builder

WORKDIR /build

COPY shared/package*.json ./shared/
WORKDIR /build/shared
RUN npm ci
COPY shared/tsconfig.json ./
COPY shared/scripts ./scripts
COPY shared/src ./src
RUN npm run build

WORKDIR /build/service
COPY payment-service/package*.json ./
RUN sed -i 's|"file:../shared"|"file:/build/shared"|' package.json
RUN npm install

COPY payment-service/tsconfig.json ./
COPY payment-service/src ./src
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /build/shared /app/shared

COPY payment-service/package*.json ./
RUN sed -i 's|"file:../shared"|"file:/app/shared"|' package.json
RUN npm install --omit=dev

COPY --from=builder /build/service/dist ./dist

EXPOSE 5004

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5004/health || exit 1

CMD ["node", "dist/index.js"]
