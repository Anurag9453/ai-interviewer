import { createServer, type Server } from "node:http";

export interface HealthInfo {
  service: string;
  provider: string;
  liveModel: string;
  [key: string]: unknown;
}

/** Liveness probe used by both the M0 health-only process and the real worker. */
export function startHealthServer(port: number, info: () => HealthInfo): Server {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...info() }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => {
    console.log(`[voice-agent] health on :${port}`);
  });
  return server;
}
