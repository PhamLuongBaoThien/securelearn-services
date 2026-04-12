# ========================
# Dockerfile: Identity Service
# Multi-stage build để giảm kích thước image
# ========================

# --- Stage 1: Build TypeScript ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files trước để tận dụng Docker cache
COPY package*.json ./

# Install tất cả dependencies (bao gồm devDependencies để build TS)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript -> JavaScript
RUN npm run build

# --- Stage 2: Production Image ---
FROM node:20-alpine

WORKDIR /app

# Copy package files và chỉ install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled JS từ builder stage
COPY --from=builder /app/dist ./dist

# Expose port (chỉ dùng trong Docker network)
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5001/health || exit 1

# Start service
CMD ["node", "dist/index.js"]
