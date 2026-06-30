FROM node:20-alpine AS build
WORKDIR /app
COPY shared ./shared
COPY notification-service ./notification-service
WORKDIR /app/shared
RUN npm ci && npm run build
WORKDIR /app/notification-service
RUN npm ci && npm run build
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/shared ./shared
COPY --from=build /app/notification-service ./notification-service
WORKDIR /app/notification-service
ENV NODE_ENV=production
CMD ["npm","start"]