/**
 * Driver Proxy — generic proxy to the Blue Driver internal API.
 *
 * When mTLS is enabled (certs mounted + SIGNER_URL is https://),
 * all proxy calls use mutual TLS with client certificates via https.request.
 * When mTLS is not enabled, uses plain fetch over HTTP.
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';

// mTLS agent — only created if certs exist
let tlsAgent: https.Agent | undefined;
const isHttps = config.signerUrl.startsWith('https');

function initMtls() {
  const certsDir = process.env.CERTS_DIR || '/app/certs';
  const certPath = path.join(certsDir, 'console-cert.pem');
  const keyPath  = path.join(certsDir, 'console-key.pem');
  const caPath   = path.join(certsDir, 'ca.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(caPath)) {
    tlsAgent = new https.Agent({
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
      ca:   fs.readFileSync(caPath),
      rejectUnauthorized: true,
    });
    logger.info('Driver proxy: mTLS agent created with client certificates');
  } else {
    logger.info('Driver proxy: no certs found, using plain HTTP');
  }
}
initMtls();

const baseHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
};
if (config.internalKey) {
  baseHeaders['X-Internal-Key'] = config.internalKey;
}

/**
 * Make an HTTP/HTTPS request to the Driver.
 * Uses https.request with mTLS agent when certs are available,
 * otherwise falls back to plain fetch.
 */
function driverRequest(method: string, driverPath: string, body?: string, extraHeaders?: Record<string, string>): Promise<any> {
  const url = `${config.signerUrl}/internal${driverPath}`;
  const allHeaders = { ...baseHeaders, ...extraHeaders };

  // If mTLS is configured, use https.request with the TLS agent
  if (isHttps && tlsAgent) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parseInt(parsed.port || '443'),
        path: parsed.pathname + parsed.search,
        method,
        headers: allHeaders,
        agent: tlsAgent,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(json.error || `Driver returned ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`Invalid JSON from Driver: ${data.substring(0, 100)}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`mTLS connection failed: ${err.message}`)));
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Driver request timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  // Plain HTTP — use fetch
  return (async () => {
    const opts: RequestInit = { method, headers: allHeaders };
    if (body) opts.body = body;
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error((data as any).error || `Driver returned ${res.status}`);
    return data;
  })();
}

export async function proxyGet(driverPath: string, extraHeaders?: Record<string, string>): Promise<any> {
  return driverRequest('GET', driverPath, undefined, extraHeaders);
}

export async function proxyPost(driverPath: string, body: any, extraHeaders?: Record<string, string>): Promise<any> {
  return driverRequest('POST', driverPath, JSON.stringify(body), extraHeaders);
}

export async function proxyPut(driverPath: string, body: any): Promise<any> {
  return driverRequest('PUT', driverPath, JSON.stringify(body));
}

export async function proxyDelete(driverPath: string): Promise<any> {
  return driverRequest('DELETE', driverPath);
}
