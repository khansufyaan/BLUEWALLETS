#!/usr/bin/env bash
# End-to-end API test using curl.
# Start the server first: npm run dev

set -euo pipefail

BASE_URL="http://localhost:3100"

echo "=== WaaS KMS API Test ==="
echo ""

# 1. Health check
echo "[1/6] Health check..."
curl -s "$BASE_URL/health" | jq .
echo ""

# 2. Generate an EC P-256 key (good for general wallet ops)
echo "[2/6] Generating EC_P256 key..."
KEY_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/keys" \
  -H "Content-Type: application/json" \
  -d '{"algorithm": "EC_P256", "label": "test-wallet-1"}')
echo "$KEY_RESPONSE" | jq .

KEY_ID=$(echo "$KEY_RESPONSE" | jq -r '.keyId')
echo "  Key ID: $KEY_ID"
echo ""

# 3. Generate a secp256k1 key (Bitcoin/Ethereum wallet key)
echo "[3/6] Generating EC_SECP256K1 key (blockchain wallet)..."
BTC_KEY=$(curl -s -X POST "$BASE_URL/api/v1/keys" \
  -H "Content-Type: application/json" \
  -d '{"algorithm": "EC_SECP256K1", "label": "btc-wallet-1"}')
echo "$BTC_KEY" | jq .
BTC_KEY_ID=$(echo "$BTC_KEY" | jq -r '.keyId')
echo ""

# 4. Sign a transaction hash (32 bytes of hex = 64 hex chars)
TX_HASH=$(openssl rand -hex 32)
echo "[4/6] Signing transaction hash: ${TX_HASH:0:16}..."
SIGN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/keys/$KEY_ID/sign" \
  -H "Content-Type: application/json" \
  -d "{\"data\": \"$TX_HASH\"}")
echo "$SIGN_RESPONSE" | jq .

SIGNATURE=$(echo "$SIGN_RESPONSE" | jq -r '.signature')
echo ""

# 5. Verify the signature
echo "[5/6] Verifying signature..."
VERIFY_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/keys/$KEY_ID/verify" \
  -H "Content-Type: application/json" \
  -d "{\"data\": \"$TX_HASH\", \"signature\": \"$SIGNATURE\"}")
echo "$VERIFY_RESPONSE" | jq .
echo ""

# 6. List all keys
echo "[6/6] Listing all keys..."
curl -s "$BASE_URL/api/v1/keys" | jq .
echo ""

# Cleanup
echo "Cleaning up test keys..."
curl -s -X DELETE "$BASE_URL/api/v1/keys/$KEY_ID" | jq .
curl -s -X DELETE "$BASE_URL/api/v1/keys/$BTC_KEY_ID" | jq .

echo ""
echo "=== API TEST COMPLETE ==="
