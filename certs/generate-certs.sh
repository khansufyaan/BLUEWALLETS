#!/bin/bash
# Generate mTLS certificates for Blue Driver ↔ Blue Console communication.
#
# Creates:
#   ca.pem / ca-key.pem           — Self-signed CA
#   driver-cert.pem / driver-key.pem — Driver server cert
#   console-cert.pem / console-key.pem — Console client cert

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Generating Blue Wallets mTLS certificates..."

# 1. CA
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -days 3650 -nodes -keyout ca-key.pem -out ca.pem \
  -subj "/CN=Blue Wallets Internal CA/O=Blue Wallets" 2>/dev/null
echo "✓ CA certificate generated"

# 2. Driver server cert
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout driver-key.pem -out driver.csr \
  -subj "/CN=blue-driver/O=Blue Wallets" 2>/dev/null

cat > driver-ext.cnf <<EOF
[v3_ext]
subjectAltName = DNS:blue-driver,DNS:localhost,IP:127.0.0.1
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -in driver.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out driver-cert.pem -days 365 \
  -extfile driver-ext.cnf -extensions v3_ext 2>/dev/null
rm -f driver.csr driver-ext.cnf
echo "✓ Driver server certificate generated"

# 3. Console client cert
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout console-key.pem -out console.csr \
  -subj "/CN=blue-console/O=Blue Wallets" 2>/dev/null

cat > console-ext.cnf <<EOF
[v3_ext]
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -in console.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out console-cert.pem -days 365 \
  -extfile console-ext.cnf -extensions v3_ext 2>/dev/null
rm -f console.csr console-ext.cnf ca.srl
echo "✓ Console client certificate generated"

echo ""
echo "Certificates generated in: $DIR"
ls -la *.pem
