FROM node:20-alpine AS build
WORKDIR /app
COPY shared ./shared
COPY inbox-service ./inbox-service
WORKDIR /app/shared
RUN npm ci && npm run build
WORKDIR /app/inbox-service
RUN npm ci && npm run build
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/shared ./shared
COPY --from=build /app/inbox-service ./inbox-service
WORKDIR /app/inbox-service
ENV NODE_ENV=production
CMD ["npm","start"]
