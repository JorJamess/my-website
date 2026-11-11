import { connect } from "node:net";

/** Ask the running Bridge service something over its private socket. Resolves null if it is not running. */
export function callService<T = unknown>(socketPath: string, cmd: string, args: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<{ ok: boolean; data?: T; error?: string } | null> {
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    let buf = "";
    const done = (v: { ok: boolean; data?: T; error?: string } | null) => {
      clearTimeout(timer);
      sock.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => done({ ok: false, error: "The Bridge did not answer in time" }), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify({ cmd, args }) + "\n"));
    sock.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        try {
          done(JSON.parse(buf.slice(0, nl)));
        } catch {
          done({ ok: false, error: "Bad answer from the Bridge" });
        }
      }
    });
    sock.on("error", () => done(null));
  });
}
