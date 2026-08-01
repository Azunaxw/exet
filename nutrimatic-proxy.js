#!/usr/bin/env node
/**
 * Minimal static file server + Nutrimatic HTML proxy for Exet.
 *
 *   node nutrimatic-proxy.js
 *   # then open http://localhost:3080/exet.html
 *
 * Proxies:
 *   GET /api/nutrimatic?<nutrimatic-query-string>
 *     -> https://nutrimatic.org/2024/?<nutrimatic-query-string>
 *
 * This lets exet-nutrimatic.html restyle Hidden / Alternations / Nutrimatic
 * web-fill results as a compact bulleted list (nutrimatic.org itself cannot
 * be styled inside a cross-origin iframe).
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3080);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || __dirname);
const NUTRIMATIC_BASE = 'https://nutrimatic.org/2024/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, data, contentType, extraHeaders = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    ...extraHeaders,
  });
  res.end(buf);
}

function proxyNutrimatic(req, res, search) {
  const target = NUTRIMATIC_BASE + (search.startsWith('?') ? search : '?' + search);
  const opts = {
    headers: {
      'User-Agent': 'Exet-nutrimatic-proxy/1.0',
      'Accept': 'text/html',
    },
  };
  https.get(target, opts, upstream => {
    const chunks = [];
    upstream.on('data', c => chunks.push(c));
    upstream.on('end', () => {
      const body = Buffer.concat(chunks);
      const status = upstream.statusCode || 502;
      // Follow one redirect (nutrimatic sometimes 302s).
      if (status >= 300 && status < 400 && upstream.headers.location) {
        https.get(upstream.headers.location, opts, up2 => {
          const chunks2 = [];
          up2.on('data', c => chunks2.push(c));
          up2.on('end', () => {
            send(res, up2.statusCode || 502, Buffer.concat(chunks2),
                 up2.headers['content-type'] || 'text/html; charset=utf-8', {
                   'Cache-Control': 'no-store',
                 });
          });
        }).on('error', err => {
          send(res, 502, 'Nutrimatic proxy error: ' + err.message,
               'text/plain; charset=utf-8');
        });
        return;
      }
      send(res, status, body,
           upstream.headers['content-type'] || 'text/html; charset=utf-8', {
             'Cache-Control': 'no-store',
           });
    });
  }).on('error', err => {
    send(res, 502, 'Nutrimatic proxy error: ' + err.message,
         'text/plain; charset=utf-8');
  });
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function serveStatic(req, res, urlPath) {
  let filePath = safeJoin(STATIC_DIR, urlPath === '/' ? '/exet.html' : urlPath);
  if (!filePath) {
    send(res, 400, 'Bad path', 'text/plain; charset=utf-8');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        send(res, 500, 'Read error', 'text/plain; charset=utf-8');
        return;
      }
      send(res, 200, data, MIME[ext] || 'application/octet-stream');
    });
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && u.pathname === '/api/nutrimatic') {
    proxyNutrimatic(req, res, u.search || '');
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, u.pathname);
    return;
  }
  send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
});

server.listen(PORT, () => {
  console.log('Exet nutrimatic proxy listening on http://localhost:' + PORT);
  console.log('Open http://localhost:' + PORT + '/exet.html');
});
