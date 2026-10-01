#!/bin/sh
# Export des données de MapMyLAN 1.4.1, à lancer dans le conteneur PostgreSQL
# de la 1.4.1 (psql y est, et les variables POSTGRES_USER / POSTGRES_DB aussi) :
#
#   docker exec -i <conteneur-db-1.4.1> sh -s < outils/exporter-v1.sh > export.json
#
# Sortie : un seul objet JSON, une entrée par table (json_agg de ses lignes).
# Puis, dans MapMyLAN 2.0 (base neuve) :
#
#   docker compose run --rm -T mapmylan node src/cli.js importer-v1 < export.json
#
# L'export contient les empreintes de mots de passe, les secrets TOTP et les
# secrets chiffrés des équipements : à garder hors de tout partage (chmod 600)
# et à effacer une fois la reprise faite.
#
# psql en mode brut (-A -t) plutôt que COPY : COPY en texte double chaque
# barre oblique inverse, ce qui corromprait tout JSON contenant un « \" ».
set -eu

PSQL="psql -X -q -A -t -v ON_ERROR_STOP=1 -U ${POSTGRES_USER:-mapmylan} -d ${POSTGRES_DB:-mapmylan}"

# Les tables reprises. PasswordReset et UserSecurity ne le sont pas (jetons
# de réinitialisation, discussion Telegram de secours : sans objet en 2.0).
TABLES="User Device Interface Port CveMatch DeviceHistory TopologyLink Zone Vlan SshDevice Alert LogEntry Setting NotificationConfig BotCommand NotificationCommand SecurityRule ScanRun HostMetric Mailbox TrafficFlow Passkey IntegrationToken"

printf '{"format":"mapmylan-v1","version":"1.4.1","tables":{'
premier=1
for t in $TABLES; do
  if [ "$premier" = 1 ]; then premier=0; else printf ','; fi
  printf '"%s":' "$t"
  existe=$($PSQL -c "SELECT to_regclass('public.\"$t\"') IS NOT NULL")
  if [ "$existe" != "t" ]; then printf '[]'; continue; fi
  # Les clés d'accès ne sont pas reprises : leur nombre suffit au bilan.
  if [ "$t" = "Passkey" ]; then
    $PSQL -c "SELECT COALESCE(json_agg(json_build_object('id', x.id)), '[]'::json) FROM \"Passkey\" x"
  else
    $PSQL -c "SELECT COALESCE(json_agg(x), '[]'::json) FROM \"$t\" x"
  fi
done
printf '}}\n'
