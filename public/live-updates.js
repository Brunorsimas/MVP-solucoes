// Fetch-based SSE keeps the existing Authorization header (EventSource cannot).
export function createLiveUpdates({ fetchEvents, onUpdate, onUnauthorized, onStatus = () => {}, retryMs = 500, silenceMs = 45000 }) {
  let current, status = 'stopped';
  const setStatus = value => { status = value; onStatus(value); };
  function stop() {
    const previous = current; current = null;
    previous?.abort.abort(); setStatus('stopped');
  }
  async function run(connection) {
    let failures = 0;
    while (current === connection && !connection.abort.signal.aborted) {
      const request = new AbortController();
      const cancel = () => request.abort();
      connection.abort.signal.addEventListener('abort', cancel, { once: true });
      let watchdog, reader, sawEvent = false;
      const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(cancel, silenceMs); };
      try {
        setStatus(failures ? 'reconnecting' : 'connecting'); alive();
        const response = await fetchEvents(request.signal);
        if (current !== connection || connection.abort.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { current = null; setStatus('stopped'); onUnauthorized(); return; }
        if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw Error('Live connection unavailable');
        reader = response.body.getReader();
        const decoder = new TextDecoder(); let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (current !== connection) return;
          alive(); buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
          if (buffer.length > 65536) throw Error('Invalid live frame');
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const event = /^event:\s*(\w+)/m.exec(frame)?.[1];
            if (event === 'auth') { current = null; setStatus('stopped'); onUnauthorized(); return; }
            if (['ready', 'change', 'heartbeat'].includes(event)) {
              if (!sawEvent) { sawEvent = true; setStatus('connected'); }
              if (event === 'ready' || event === 'change') onUpdate();
            }
          }
        }
      } catch { /* Reconnect and fetch a fresh authorized snapshot on ready. */ }
      finally {
        clearTimeout(watchdog); request.abort();
        connection.abort.signal.removeEventListener('abort', cancel);
        await reader?.cancel().catch(() => {});
      }
      if (current !== connection || connection.abort.signal.aborted) return;
      setStatus('reconnecting');
      failures = sawEvent ? 1 : failures + 1;
      const delay = Math.min(10000, retryMs * 2 ** Math.min(failures - 1, 5));
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); connection.abort.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, delay);
        connection.abort.signal.addEventListener('abort', done, { once: true });
      });
    }
  }
  return {
    start(key) {
      if (!key) { if (current) stop(); return; }
      if (current?.key === key) return;
      stop(); const connection = { key, abort: new AbortController() }; current = connection;
      void run(connection);
    },
    stop,
    get status() { return status; }
  };
}
