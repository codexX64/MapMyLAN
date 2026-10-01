# syntax=docker/dockerfile:1
# MapMyLAN 2 : Node seul, aucune dépendance npm. L'image de base est épinglée
# par empreinte (index multi-architecture amd64 + arm64) : une étiquette peut
# être déplacée, une empreinte non.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
FROM ${NODE_IMAGE}

# Les outils du balayage (ceux de la 1.4.1), pris dans un instantané daté de
# Debian : la même date redonne exactement les mêmes paquets, signatures
# vérifiées par apt. Changer la date est un geste explicite de mise à jour.
ARG DEBIAN_INSTANTANE=20260915T000000Z
RUN printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/%s bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/%s bookworm-security main\n' \
      "$DEBIAN_INSTANTANE" "$DEBIAN_INSTANTANE" > /etc/apt/sources.list \
 && rm -f /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates nmap arp-scan iputils-ping openssh-client avahi-utils samba-common-bin snmp iproute2 \
 && rm -rf /var/lib/apt/lists/* \
 # Aucun programme setuid ou setgid, aucune capacité de fichier : personne ne
 # redevient root, rien ne s'élève à l'exécution. L'accès aux sockets bruts du
 # balayage est donné au lancement du conteneur (voir docker-compose.yml).
 && find / -xdev -perm /6000 -type f -exec chmod a-s {} +

WORKDIR /app
COPY package.json ./
COPY socle ./socle
COPY src ./src
COPY web ./web
RUN chmod 0555 src/demande-secret.js \
 && mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production DATA_DIR=/app/data
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const h = process.env.HOTE && process.env.HOTE !== '0.0.0.0' ? process.env.HOTE : '127.0.0.1'; fetch(`http://${h}:${process.env.PORT || 8090}/api/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.js"]
