#!/usr/bin/env bash
# MapMyLAN v2.9 patch
#
# Fixes:
#   • Wheel zoom now anchors precisely on the cursor: the world point you point
#     at stays exactly under the mouse during zoom in / zoom out, regardless of
#     where the cursor is on the map (left, right, corner, anywhere).
#   • Sidebar entry renamed "Host" → "Monitoring".

set -e
cd "$(dirname "$0")/.."
[ -f docker-compose.yml ] || { echo "✕ Run from inside ~/mapmylan"; exit 1; }
PATCH="$(dirname "$0")"
echo "→ Applying v2.9 patch"
cp "$PATCH/frontend/src/components/topology/TopologyMap.tsx" frontend/src/components/topology/TopologyMap.tsx
cp "$PATCH/frontend/src/components/layout/AppShell.tsx"      frontend/src/components/layout/AppShell.tsx
echo "→ Rebuilding frontend…"
docker compose build frontend
docker compose up -d --force-recreate frontend
echo ""
echo "✓ MapMyLAN v2.9 applied. Hard-refresh (Ctrl+Shift+R)."
