#!/usr/bin/env bash
# ============================================================
#  WaaS — Wallet-as-a-Service Installer
#  One-command setup for development (SoftHSM) or
#  production (Luna Cloud HSM / DPoD)
# ============================================================

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

step() { echo -e "\n${BLUE}[$1/7]${NC} ${BOLD}$2${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     WaaS — Wallet-as-a-Service Setup     ║"
echo "  ║     HSM-Backed Blockchain Wallets         ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Step 1: System Check ───────────────────────────────────
step 1 "System Check"

OS=$(uname -s)
ARCH=$(uname -m)
ok "Platform: $OS $ARCH"

if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  ok "Node.js: $NODE_VER"
else
  fail "Node.js not found. Install from https://nodejs.org"
fi

if command -v npm &>/dev/null; then
  ok "npm: $(npm -v)"
else
  fail "npm not found"
fi

# ─── Step 2: HSM Mode Selection ─────────────────────────────
step 2 "HSM Configuration"

echo ""
echo "  Select HSM mode:"
echo "    1) SoftHSM (local development — no hardware needed)"
echo "    2) Luna Cloud HSM (Thales DPoD sandbox)"
echo "    3) Luna Network HSM (on-premises production)"
echo ""

read -rp "  Enter choice [1]: " HSM_CHOICE
HSM_CHOICE=${HSM_CHOICE:-1}

case $HSM_CHOICE in
  1)
    HSM_MODE="softhsm"
    ok "Mode: SoftHSM (development)"
    ;;
  2)
    HSM_MODE="dpod"
    ok "Mode: Luna Cloud HSM (DPoD)"
    ;;
  3)
    HSM_MODE="luna"
    ok "Mode: Luna Network HSM (production)"
    ;;
  *)
    fail "Invalid choice"
    ;;
esac

# ─── Step 3: HSM Setup ──────────────────────────────────────
step 3 "HSM Setup"

if [[ "$HSM_MODE" == "softhsm" ]]; then
  # Install SoftHSM if needed
  if ! command -v softhsm2-util &>/dev/null; then
    echo "  Installing SoftHSM2..."
    if [[ "$OS" == "Darwin" ]]; then
      brew install softhsm 2>/dev/null || fail "brew install softhsm failed"
    elif [[ -f /etc/debian_version ]]; then
      sudo apt-get update -qq && sudo apt-get install -y -qq softhsm2
    else
      fail "Install SoftHSM2 manually for your OS"
    fi
  fi
  ok "SoftHSM2 installed"

  # Init token
  SOFTHSM_TOKEN_DIR="$HOME/.softhsm/tokens"
  mkdir -p "$SOFTHSM_TOKEN_DIR"
  SOFTHSM_CONF="$HOME/.softhsm/softhsm2.conf"
  [[ -f "$SOFTHSM_CONF" ]] || echo "directories.tokendir = $SOFTHSM_TOKEN_DIR" > "$SOFTHSM_CONF"
  export SOFTHSM2_CONF="$SOFTHSM_CONF"

  softhsm2-util --delete-token --token "waas-dev" 2>/dev/null || true
  softhsm2-util --init-token --slot 0 --label "waas-dev" --pin 1234 --so-pin 5678 >/dev/null 2>&1
  ok "SoftHSM token initialized (label: waas-dev, PIN: 1234)"

  # Detect lib path
  if [[ "$OS" == "Darwin" ]]; then
    if [[ -f "/opt/homebrew/lib/softhsm/libsofthsm2.so" ]]; then
      PKCS11_LIB="/opt/homebrew/lib/softhsm/libsofthsm2.so"
    else
      PKCS11_LIB="/usr/local/lib/softhsm/libsofthsm2.so"
    fi
  else
    PKCS11_LIB="/usr/lib/softhsm/libsofthsm2.so"
  fi

  # Write .env
  cat > "$PROJECT_DIR/.env" << EOF
HSM_USE_SOFTHSM=true
SOFTHSM_LIB=$PKCS11_LIB
HSM_SLOT_INDEX=0
HSM_PIN=1234
HSM_LABEL=waas-dev
PORT=3100
NODE_ENV=development
LOG_LEVEL=debug
EOF
  ok "Configuration written to .env"

elif [[ "$HSM_MODE" == "dpod" ]]; then
  echo ""
  echo "  Luna Cloud HSM (DPoD) requires Docker."
  echo ""
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    ok "Docker is running"
  else
    warn "Docker not running. Start OrbStack or Docker Desktop first."
    echo ""
    echo "  Then run:"
    echo "    HSM_PIN=<your-partition-pin> docker compose -f docker-compose.luna.yml up --build"
    echo ""
  fi

  if [[ -f "$PROJECT_DIR/luna-client/Chrystoki.conf" ]]; then
    ok "Luna client files found in luna-client/"
  else
    warn "Copy your DPoD client files to $PROJECT_DIR/luna-client/"
    echo "  Required: Chrystoki.conf, cvclient-min.tar, *.pem certificates"
  fi

  read -rp "  Enter your DPoD Partition PIN: " DPOD_PIN
  cat > "$PROJECT_DIR/.env.luna" << EOF
HSM_USE_SOFTHSM=false
HSM_PKCS11_LIB=/opt/lunaclient/libs/64/libCryptoki2.so
HSM_SLOT_INDEX=0
HSM_PIN=$DPOD_PIN
HSM_LABEL=waas-dpod
PORT=3100
NODE_ENV=production
LOG_LEVEL=info
EOF
  ok "Luna config written to .env.luna"
  echo ""
  echo "  To run with Luna: HSM_PIN=$DPOD_PIN docker compose -f docker-compose.luna.yml up --build"

elif [[ "$HSM_MODE" == "luna" ]]; then
  if [[ -f "/usr/safenet/lunaclient/lib/libCryptoki2_64.so" ]]; then
    ok "Luna Client found at /usr/safenet/lunaclient/"
  else
    fail "Luna Client not installed. Install from Thales support portal."
  fi

  read -rp "  Enter Partition PIN: " LUNA_PIN

  cat > "$PROJECT_DIR/.env" << EOF
HSM_USE_SOFTHSM=false
HSM_PKCS11_LIB=/usr/safenet/lunaclient/lib/libCryptoki2_64.so
HSM_SLOT_INDEX=0
HSM_PIN=$LUNA_PIN
HSM_LABEL=waas-production
PORT=3100
NODE_ENV=production
LOG_LEVEL=info
EOF
  ok "Configuration written to .env"
fi

# ─── Step 4: Install Dependencies ───────────────────────────
step 4 "Installing Dependencies"

cd "$PROJECT_DIR"
npm ci --silent 2>&1 | tail -1 || npm install --silent 2>&1 | tail -1
ok "Node.js dependencies installed"

# ─── Step 5: Build ───────────────────────────────────────────
step 5 "Building"

npx tsc 2>&1
ok "TypeScript compiled"

# ─── Step 6: Test HSM Connection ─────────────────────────────
step 6 "Testing HSM Connection"

if [[ "$HSM_MODE" == "softhsm" ]]; then
  export SOFTHSM2_CONF="$HOME/.softhsm/softhsm2.conf"
  npx tsx scripts/test-hsm-connection.ts 2>&1 | grep -E "(✓|✗|HSM CONNECTION)" || true
  echo ""
  npx tsx scripts/test-key-operations.ts 2>&1 | grep -E "(✓|✗|PASSED|FAILED|Results)" || true
elif [[ "$HSM_MODE" == "dpod" ]]; then
  warn "Skipping HSM test (requires Docker). Run manually after docker compose up."
else
  npx tsx scripts/test-hsm-connection.ts 2>&1 | grep -E "(✓|✗|HSM CONNECTION)" || true
fi

# ─── Step 7: Done ────────────────────────────────────────────
step 7 "Ready!"

echo ""
echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}  ║          Setup Complete!                  ║${NC}"
echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════╝${NC}"
echo ""

if [[ "$HSM_MODE" == "softhsm" ]]; then
  echo "  Start the server:"
  echo -e "    ${BOLD}npm run dev${NC}"
  echo ""
  echo "  Open in your browser:"
  echo -e "    ${BOLD}http://localhost:3100${NC}"
elif [[ "$HSM_MODE" == "dpod" ]]; then
  echo "  Start with Luna Cloud HSM:"
  echo -e "    ${BOLD}HSM_PIN=<pin> docker compose -f docker-compose.luna.yml up --build${NC}"
  echo ""
  echo "  Open in your browser:"
  echo -e "    ${BOLD}http://localhost:3100${NC}"
else
  echo "  Start the server:"
  echo -e "    ${BOLD}npm start${NC}"
fi

echo ""
echo "  Supported chains: Bitcoin, Ethereum, Solana, BSC, Polygon, Arbitrum, Tron, Avalanche, Litecoin"
echo ""
