FROM node:20-alpine AS builder
WORKDIR /build/service
COPY content-service/package*.json ./
RUN npm ci
COPY content-service/tsconfig.json ./
COPY content-service/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY content-service/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /build/service/dist ./dist
EXPOSE 5008
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:5008/health || exit 1
CMD ["node", "dist/index.js"]
