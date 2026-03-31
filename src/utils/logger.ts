import winston from 'winston';
import TransportStream from 'winston-transport';
import { serverConfig } from '../config';

// ── In-memory circular log buffer (last 200 entries) ─────────────────────────

export interface LogEntry {
  ts:    string;   // HH:MM:SS
  level: string;   // info | warn | error
  msg:   string;
}

const LOG_BUFFER_SIZE = 200;
const logBuffer: LogEntry[] = [];

/** Strip ANSI escape codes from log level strings written in colorized mode */
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

export function getLogBuffer(service?: string): LogEntry[] {
  const all = [...logBuffer].reverse(); // newest first
  if (!service || service === 'all') return all.slice(0, 100);
  return all.filter(e => {
    if (service === 'hsm')    return /hsm|pkcs11|session|slot|token|connect/i.test(e.msg);
    if (service === 'api')    return /request|response|route|server|listening/i.test(e.msg);
    if (service === 'kms')    return /kms|key|sign|deriv/i.test(e.msg);
    if (service === 'policy') return /policy|rule|engine|evaluat/i.test(e.msg);
    if (service === 'rbac')   return /rbac|role|permission/i.test(e.msg);
    if (service === 'wallet') return /wallet/i.test(e.msg);
    if (service === 'vault')  return /vault/i.test(e.msg);
    return true;
  }).slice(0, 50);
}

// Custom winston transport that writes to the in-memory buffer
class MemoryTransport extends TransportStream {
  log(info: any, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));
    const ts  = new Date().toISOString().slice(11, 19);
    const entry: LogEntry = {
      ts,
      level: stripAnsi(String(info.level || 'info')),
      msg:   String(info.message || ''),
    };
    if (logBuffer.length >= LOG_BUFFER_SIZE) logBuffer.shift();
    logBuffer.push(entry);
    callback();
  }
}

export const logger = winston.createLogger({
  level: serverConfig.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    serverConfig.nodeEnv === 'development'
      ? winston.format.combine(winston.format.colorize(), winston.format.simple())
      : winston.format.json()
  ),
  defaultMeta: { service: 'waas-kms' },
  transports: [
    new winston.transports.Console(),
    new MemoryTransport(),
  ],
});
