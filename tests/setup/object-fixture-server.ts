// tests/setup/object-fixture-server.ts — Silo B: an IN-PROCESS HTTP object
// store bound to 127.0.0.1 on an ephemeral port, torn down with the test.
//
// WHY NOT MinIO: it is AGPL-3.0, and a repo compose file embedding it is a
// distribution question the loop must not settle alone. If real SigV4 is
// ever needed, the Apache-2.0 candidates are adobe/S3Mock and gaul/s3proxy
// (recorded here per the acceptance); for profiling, this fixture speaks
// the two verbs the catalog uses — LIST (delimiter walk) and GET — with no
// auth, no docker, no network egress beyond loopback.

import { createServer, type Server } from "node:http";
import type { ListedObject } from "../../src/lib/catalog/tier1-object";

export interface FixtureBucket {
  objects: ListedObject[];
  /** Optional raw bytes per key (xlsx/pdf/garbage fixtures). */
  bodies?: Map<string, Buffer>;
}

export interface FixtureServer {
  url: string;
  server: Server;
  /** Every request the server saw — the tier-1 ZERO-GET assertion reads it. */
  requests: { method: string; path: string }[];
  close(): Promise<void>;
}

export async function startObjectFixture(bucket: FixtureBucket): Promise<FixtureServer> {
  const requests: { method: string; path: string }[] = [];
  const bodies = bucket.bodies ?? new Map<string, Buffer>();

  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? "?", path: req.url ?? "/" });
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = decodeURIComponent(url.pathname.replace(/^\/objects?/, ""));

    // LIST is its own route — a GET of /list is a listing, not an object.
    if (url.pathname === "/list" && (req.method === "GET" || req.method === "POST")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ objects: bucket.objects }));
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      // Object GET: /<key>
      const body = bodies.get(path.replace(/^\//, ""));
      if (!body) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("no such key");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(body.length),
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    if (req.method === "POST" || req.method === "GET") {
      // LIST: a flat JSON listing — the delimiter walk is the caller's.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ objects: bucket.objects }));
      return;
    }

    res.writeHead(405);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server did not bind a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** The listing the fixture serves, shaped for mapObjectListing. */
export function fixtureListing(server: FixtureServer): Promise<ListedObject[]> {
  return (async () => {
    const res = await fetch(`${server.url}/list`);
    const body = (await res.json()) as { objects: ListedObject[] };
    return body.objects;
  })();
}
