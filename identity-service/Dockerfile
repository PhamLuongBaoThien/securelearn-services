# ========================
# Dockerfile: Identity Service
# Build context phải là backend/ (không phải identity-service/)
# Vì cần copy thư mục shared/ nằm cùng cấp
# ========================

# --- Stage 1: Build TypeScript ---
FROM node:20-alpine AS builder

WORKDIR /build

# ----- Build shared library trước -----
COPY shared/package*.json ./shared/
WORKDIR /build/shared
RUN npm ci
COPY shared/tsconfig.json ./
COPY shared/scripts ./scripts
COPY shared/src ./src
RUN npm run build

# ----- Build identity-service -----
WORKDIR /build/service
COPY identity-service/package*.json ./

# Sửa dependency path: trong Docker, shared nằm ở /build/shared
RUN sed -i 's|"file:../shared"|"file:/build/shared"|' package.json
RUN npm install

COPY identity-service/tsconfig.json ./
COPY identity-service/src ./src
RUN npm run build

# --- Stage 2: Production Image ---
FROM node:20-alpine

WORKDIR /app

# Copy shared lib đã build
COPY --from=builder /build/shared /app/shared

# Copy package files và sửa path cho production
COPY identity-service/package*.json ./
RUN sed -i 's|"file:../shared"|"file:/app/shared"|' package.json
RUN npm install --omit=dev

# Copy compiled JS
COPY --from=builder /build/service/dist ./dist

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5001/health || exit 1

CMD ["node", "dist/index.js"]
