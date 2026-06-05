import { createServer } from "node:net";

export async function findFreePort(start: number, maxTries: number = 100): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const port = start + i;
    const free = await isFree(port);
    if (free) return port;
  }
  throw new Error(`no free port in ${start}..${start + maxTries - 1}`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}
