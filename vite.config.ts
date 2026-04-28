import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';

// Carrega .env e injeta no process.env para que os handlers /api/ consigam ler
// MASTER_PASSWORD, SUPABASE_SERVICE_ROLE_KEY etc. (não são prefixados com VITE_)
function loadBackendEnv() {
  try {
    const raw = readFileSync(path.resolve(__dirname, '.env'), 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {}
}

loadBackendEnv();

// Plugin que simula as Vercel Functions (/api/*.js) em dev local.
// Em produção a Vercel serve esses arquivos diretamente — aqui só forwarda.
function apiDevPlugin() {
  return {
    name: 'api-dev-server',
    configureServer(server: any) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();

        // /api/master-users?id=xxx → api/master-users.js
        const pathname = url.split('?')[0];
        const handlerFile = path.resolve(__dirname, `.${pathname}.js`);

        // Parseia body JSON
        let body: unknown = {};
        if (req.method && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
          body = await new Promise((resolve) => {
            let raw = '';
            req.on('data', (c: Buffer) => { raw += c.toString(); });
            req.on('end', () => {
              try { resolve(JSON.parse(raw)); } catch { resolve({}); }
            });
          });
        }

        try {
          // Bust de cache: adiciona timestamp pra recarregar mudanças no arquivo
          const modUrl = pathToFileURL(handlerFile).href + `?t=${Date.now()}`;
          const mod = await import(modUrl);
          const handler = mod.default;
          if (typeof handler !== 'function') return next();

          // Injeta body parseado e query string como o Express faria
          const qs = url.includes('?') ? Object.fromEntries(new URLSearchParams(url.split('?')[1])) : {};
          Object.assign(req, { body, query: qs });

          // Adapta res para API Express (status/json/send/end)
          const resProxy = Object.assign(res, {
            status(code: number) { res.statusCode = code; return resProxy; },
            json(data: unknown) {
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
              }
              return resProxy;
            },
            send(data: unknown) {
              if (!res.headersSent) res.end(typeof data === 'string' ? data : JSON.stringify(data));
              return resProxy;
            },
          });

          await handler(req, resProxy);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Cannot find module') || msg.includes('ERR_MODULE_NOT_FOUND')) {
            return next();
          }
          console.error('[api-dev]', msg);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDevPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
});
