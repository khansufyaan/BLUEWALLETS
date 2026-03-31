#!/usr/bin/env bash
# Setup SoftHSM2 for local development — mimics Luna Cloud HSM interface
# SoftHSM2 implements PKCS#11, so your code works identically against
# SoftHSM (dev) and Luna HSM (staging/production).

set -euo pipefail

echo "=== SoftHSM2 Setup for WaaS KMS ==="

# Check if softhsm2 is installed
if ! command -v softhsm2-util &> /dev/null; then
  echo "SoftHSM2 not found. Installing..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install softhsm
  elif [[ -f /etc/debian_version ]]; then
    sudo apt-get update && sudo apt-get install -y softhsm2
  elif [[ -f /etc/redhat-release ]]; then
    sudo yum install -y softhsm
  else
    echo "Please install SoftHSM2 manually for your OS."
    exit 1
  fi
fi

# Create token directory
SOFTHSM_TOKEN_DIR="$HOME/.softhsm/tokens"
mkdir -p "$SOFTHSM_TOKEN_DIR"

# Create config if not exists
SOFTHSM_CONF="$HOME/.softhsm/softhsm2.conf"
if [[ ! -f "$SOFTHSM_CONF" ]]; then
  echo "directories.tokendir = $SOFTHSM_TOKEN_DIR" > "$SOFTHSM_CONF"
  echo "Created SoftHSM config at $SOFTHSM_CONF"
fi

export SOFTHSM2_CONF="$SOFTHSM_CONF"

# Delete existing token (if re-running)
softhsm2-util --delete-token --token "waas-dev" 2>/dev/null || true

# Initialize a new token
echo "Initializing SoftHSM token 'waas-dev'..."
softhsm2-util --init-token \
  --slot 0 \
  --label "waas-dev" \
  --pin 1234 \
  --so-pin 5678

echo ""
echo "=== Token created ==="
softhsm2-util --show-slots

# Detect library path
SOFTHSM_LIB=""
if [[ "$OSTYPE" == "darwin"* ]]; then
  # Homebrew on Apple Silicon
  if [[ -f "/opt/homebrew/lib/softhsm/libsofthsm2.so" ]]; then
    SOFTHSM_LIB="/opt/homebrew/lib/softhsm/libsofthsm2.so"
  # Homebrew on Intel
  elif [[ -f "/usr/local/lib/softhsm/libsofthsm2.so" ]]; then
    SOFTHSM_LIB="/usr/local/lib/softhsm/libsofthsm2.so"
  fi
elif [[ -f "/usr/lib/softhsm/libsofthsm2.so" ]]; then
  SOFTHSM_LIB="/usr/lib/softhsm/libsofthsm2.so"
elif [[ -f "/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so" ]]; then
  SOFTHSM_LIB="/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so"
fi

echo ""
echo "=== Your .env for local development ==="
echo ""
echo "HSM_USE_SOFTHSM=true"
echo "SOFTHSM_LIB=$SOFTHSM_LIB"
echo "HSM_SLOT_INDEX=0"
echo "HSM_PIN=1234"
echo "HSM_LABEL=waas-dev"
echo "PORT=3100"
echo "NODE_ENV=development"
echo "LOG_LEVEL=debug"
echo ""
echo "Copy the above into your .env file."
