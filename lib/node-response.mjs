import { Readable } from 'node:stream';

// Do not buffer SSE until completion: flush headers and forward each chunk.
export function sendNodeResponse(response, destination) {
  destination.writeHead(response.status, Object.fromEntries(response.headers));
  destination.flushHeaders();
  if (!response.body) return destination.end();
  const stream = Readable.fromWeb(response.body);
  destination.once('close', () => stream.destroy());
  stream.on('error', () => destination.destroy());
  stream.pipe(destination);
}
