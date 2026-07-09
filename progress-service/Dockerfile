FROM node:20.19.4-alpine3.21 AS builder
WORKDIR /build/shared
COPY shared/package*.json ./
RUN npm ci
COPY shared/tsconfig.json ./
COPY shared/scripts ./scripts
COPY shared/src ./src
RUN npm run build

WORKDIR /build/service
COPY progress-service/package*.json ./
RUN npm ci
COPY progress-service/tsconfig.json ./
COPY progress-service/src ./src
RUN npm run build

FROM node:20.19.4-alpine3.21 AS runtime

ENV NODE_ENV=production
WORKDIR /app/shared
COPY shared/package*.json ./
COPY --from=builder /build/shared/dist ./dist
RUN npm ci --omit=dev

WORKDIR /app/service
COPY progress-service/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/service/dist ./dist

USER node
EXPOSE 5005
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:5005/health/live || exit 1
CMD ["node", "dist/index.js"]