import { requireThat } from '../public/domain.js';

export const LIVE_CHANNEL = 'mvp_state_updates';

// One direct LISTEN connection per process, shared by all of its SSE clients.
// Notifications carry no messages, identifiers, or personal data.
export function postgresNotifications(connectionString, { ClientClass } = {}) {
  const callbacks = new Set();
  let client, ready, idleTimer;
  const disconnected = current => {
    if (client !== current) return;
    client = ready = undefined;
    for (const callback of [...callbacks]) callback('disconnect');
  };
  return {
    async subscribe(callback) {
      clearTimeout(idleTimer); callbacks.add(callback);
      try {
        if (!ready) ready = (async () => {
          requireThat(connectionString, 'Conexão de atualizações ainda não configurada.', 503);
          const url = new URL(connectionString);
          requireThat(!url.hostname.includes('-pooler.'), 'Atualizações exigem conexão direta ao banco.', 503);
          url.searchParams.set('sslmode', 'verify-full');
          const Client = ClientClass || (await import('pg')).Client;
          const current = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000, keepAlive: true });
          client = current;
          current.on('error', () => { disconnected(current); current.end().catch(() => {}); });
          current.on('end', () => disconnected(current));
          current.on('notification', message => {
            if (message.channel === LIVE_CHANNEL) for (const fn of [...callbacks]) fn('change');
          });
          await current.connect(); await current.query(`LISTEN ${LIVE_CHANNEL}`);
        })().catch(error => {
          const current = client; client = ready = undefined;
          current?.end().catch(() => {}); throw error;
        });
        await ready;
      } catch (error) { callbacks.delete(callback); throw error; }
      return () => {
        callbacks.delete(callback);
        if (!callbacks.size) idleTimer = setTimeout(() => {
          if (callbacks.size) return;
          const current = client; client = ready = undefined;
          current?.end().catch(() => {});
        }, 1000);
        idleTimer?.unref?.();
      };
    }
  };
}

export function memoryNotifications() {
  const callbacks = new Set();
  return {
    subscribe: async callback => { callbacks.add(callback); return () => callbacks.delete(callback); },
    publish: () => { for (const callback of [...callbacks]) callback('change'); }
  };
}

export function createLiveEvents(source, { heartbeatMs = 15000, maxAgeMs = 300000, perUser = 5 } = {}) {
  const clients = new Set(), encoder = new TextEncoder();
  return {
    async open(request, { userId, authorize, headers = {} }) {
      requireThat([...clients].filter(c => c.userId === userId).length < perUser, 'Muitas conexões abertas nesta conta.', 429);
      const entry = { userId }; clients.add(entry);
      let controller, unsubscribe, heartbeat, lifetime, stopped = false, checking = false;
      const close = () => {
        const release = unsubscribe; unsubscribe = undefined;
        void Promise.resolve(release?.()).catch(() => {});
        if (stopped) return;
        stopped = true; clearInterval(heartbeat); clearTimeout(lifetime);
        request.signal.removeEventListener('abort', close);
        clients.delete(entry);
        try { controller?.close(); } catch {}
      };
      const send = event => {
        if (stopped || !controller) return;
        // Bound memory for slow or disconnected readers; reconnect resyncs state.
        if (controller.desiredSize <= 0) return close();
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`)); } catch { close(); }
      };
      entry.close = close;
      try {
        unsubscribe = await source.subscribe(kind => kind === 'disconnect' ? close() : send('change'));
        await authorize();
        requireThat(!request.signal.aborted && !stopped, 'Conexão interrompida.', 503);
        const body = new ReadableStream({
          start(stream) {
            controller = stream; send('ready');
            request.signal.addEventListener('abort', close, { once: true });
            heartbeat = setInterval(async () => {
              if (checking || stopped) return;
              checking = true;
              try { await authorize(); send('heartbeat'); }
              catch (error) { if ([401, 403].includes(error.status)) send('auth'); close(); }
              finally { checking = false; }
            }, heartbeatMs);
            lifetime = setTimeout(close, maxAgeMs);
            heartbeat.unref?.(); lifetime.unref?.();
          },
          cancel: close
        }, { highWaterMark: 64 });
        return new Response(body, { headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
      } catch (error) { close(); throw error; }
    },
    close() { for (const entry of [...clients]) entry.close(); },
    get size() { return clients.size; }
  };
}
