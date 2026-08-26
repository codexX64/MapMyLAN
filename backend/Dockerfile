FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
# Build reproductible : installe exactement le lockfile (SEC-DEP-001).
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap arp-scan iputils-ping openssh-client \
    libcap2-bin avahi-utils smbclient samba-common-bin \
    snmp procps net-tools curl ncat \
    && rm -rf /var/lib/apt/lists/*

RUN setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip $(which nmap) \
 && setcap cap_net_raw,cap_net_admin+eip $(which arp-scan) \
 && setcap cap_net_raw,cap_net_admin+eip $(which ping) || true

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
# Catalogue des fournisseurs de courrier : charge par require() depuis
# process.cwd(), donc /app. Sans lui, routes/mail.ts leve au demarrage.
COPY mail-providers.js ./
EXPOSE 4000
# db push instead of migrate (no migrations checked in)
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx prisma db seed && node dist/index.js"]
