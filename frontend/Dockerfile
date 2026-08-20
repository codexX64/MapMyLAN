FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
# Reproducible build from the lockfile (SEC-DEP-001). npm 10 (shipped with
# node:20) fixes the rollup optional-deps bug that once forced discarding the
# lockfile; we can therefore go back to `npm ci`, which is deterministic.
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
