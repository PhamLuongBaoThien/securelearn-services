FROM node:20.19.4-alpine3.21 AS builder
WORKDIR /build/service
COPY content-service/package*.json ./
RUN npm ci
COPY content-service/tsconfig.json ./
COPY content-service/src ./src
RUN npm run build

FROM node:20.19.4-alpine3.21 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY content-service/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/service/dist ./dist
USER node
EXPOSE 5008
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:5008/health/live || exit 1
CMD ["node", "dist/index.js"]