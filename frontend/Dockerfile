FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
# Build reproductible depuis le lockfile (SEC-DEP-001). npm 10 (fourni par
# node:20) corrige le bug d'optional-deps rollup qui imposait naguère de jeter le
# lockfile ; on peut donc revenir à `npm ci`, déterministe.
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
