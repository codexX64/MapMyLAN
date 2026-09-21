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
# Gabarit, pas configuration finale : l'entree de l'image nginx execute envsubst
# sur /etc/nginx/templates/*.template au demarrage, puis depose le resultat dans
# conf.d. Le filtre restreint la substitution a la seule variable API_UPSTREAM :
# sans lui, envsubst remplacerait aussi $host, $uri et $scheme, qui sont des
# variables nginx et non des variables d'environnement.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=172.17.0.1:4000
ENV NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
EXPOSE 80
