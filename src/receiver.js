// -----------------------------------------------------------------------------
// Local receiver: the HTTP endpoint GPSLogger calls on the home network.
//
// It runs in the `receiver` sub-container (same image, GPSLOGGER_ROLE=receiver)
// because only a sub-container can publish a port on the LAN. It holds no
// Gladys credentials and no logic: it queues the raw requests in memory, and
// the integration drains the queue over the private network of the
// integration (GET /internal/drain, authenticated by a secret the integration
// generated and passed when it started the sub-container). The token check,
// the parsing and everything else happen in the integration.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'receiver' });

export const RECEIVER_PORT = 8080;
export const DRAIN_PATH = '/internal/drain';
export const SECRET_HEADER = 'x-relay-secret';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUEUE = 1000;

function sameSecret(received, expected) {
  if (typeof received !== 'string' || !expected) {
    return false;
  }
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * Create the receiver server (not listening yet).
 * @param {{ secret: string, maxQueue?: number }} options
 */
export function createReceiver({ secret, maxQueue = MAX_QUEUE }) {
  let queue = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://receiver');

    if (url.pathname === '/health') {
      reply(res, 200, 'ok');
      return;
    }

    if (url.pathname === DRAIN_PATH) {
      if (req.method !== 'GET' || !sameSecret(req.headers[SECRET_HEADER], secret)) {
        reply(res, 403, 'Forbidden');
        return;
      }
      const drained = queue;
      queue = [];
      reply(res, 200, JSON.stringify(drained), 'application/json');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      reply(res, 405, 'Method Not Allowed');
      return;
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      if (tooLarge && !res.headersSent) {
        reply(res, 413, 'Payload Too Large');
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        reply(res, 413, 'Payload Too Large');
        return;
      }
      if (queue.length >= maxQueue) {
        // The integration is not draining (Gladys down?): keep the newest.
        queue.shift();
      }
      queue.push({
        query: Object.fromEntries(url.searchParams),
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: req.headers['content-type'] ?? '',
        authorization: req.headers.authorization ?? '',
        received_at: new Date().toISOString(),
      });
      reply(res, 200, 'OK');
    });
  });

  return { server, queueSize: () => queue.length };
}

/** Entry point of the sub-container. */
export function runReceiver(env = process.env) {
  const secret = env.RELAY_SECRET ?? '';
  if (!secret) {
    logger.warn('RELAY_SECRET is not set: the integration cannot drain the positions');
  }
  const port = Number(env.PORT ?? RECEIVER_PORT);
  const { server } = createReceiver({ secret });
  server.listen(port, () => logger.info(`GPSLogger receiver listening on port ${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}
