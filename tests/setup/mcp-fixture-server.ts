// An in-process MCP server bound to 127.0.0.1 on an ephemeral port, for
// cnp-02's sync tests. No docker, no external network, no egress beyond
// loopback — and the test still has to name the host in Servo's outbound
// allowlist to reach it, because the client goes through the same guard a
// production sync does.
//
// This speaks the SERVER half of Streamable HTTP by hand, deliberately.
// cnp-02's adopt-first verdict forbids a hand-rolled JSON-RPC *client* and
// that is what src/lib/mcp-client.ts obeys: the SDK owns Servo's side of
// this conversation. The fixture is the other side — a stand-in for someone
// else's server — and hand-rolling it keeps the test's failure modes visible
// (a listTools response is a literal in this file) instead of hiding them in
// a second SDK instance whose behaviour the test would then be asserting.
// It mirrors Servo's own hand-rolled server route, so the two agree.

import { createServer, type Server } from "node:http";

export interface FixtureTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** MCP's open extension record — where a server declares things like the
   *  risk level the quarantine rail records and ignores. */
  _meta?: Record<string, unknown>;
  /** The closed annotation schema (title, the four *Hint booleans). */
  annotations?: Record<string, unknown>;
}

export interface McpFixtureServer {
  url: string;
  host: string;
  server: Server;
  /** Every request the fixture saw, with the Authorization header it carried. */
  requests: { method: string; rpc: string | null; authorization: string | null }[];
  /** Swap the served tool list mid-test to simulate an upstream change. */
  setTools(tools: FixtureTool[]): void;
  close(): Promise<void>;
}

export interface FixtureOptions {
  /** Accept the connection and never answer — for the timeout test. */
  hang?: boolean;
  /** Fail every request with the caller's own Authorization header in the
   *  body — a server trying to get the stored token echoed back to the admin. */
  echoAuthIn500?: boolean;
}

export async function startMcpFixture(
  initial: FixtureTool[],
  options: FixtureOptions = {},
): Promise<McpFixtureServer> {
  let tools = initial;
  const requests: { method: string; rpc: string | null; authorization: string | null }[] = [];

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    if (req.method !== "POST") {
      // The SDK opens a standalone GET stream after initialize; 405 is the
      // spec's way of saying "this server offers no server-initiated events".
      requests.push({ method: req.method ?? "?", rpc: null, authorization: req.headers.authorization ?? null });
      res.writeHead(405).end();
      return;
    }

    let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      message = JSON.parse(Buffer.concat(chunks).toString()) as typeof message;
    } catch {
      res.writeHead(400).end();
      return;
    }
    requests.push({
      method: "POST",
      rpc: message.method ?? null,
      authorization: req.headers.authorization ?? null,
    });

    // A server that accepts the request and then says nothing: the failure
    // an unbounded client hangs on forever.
    if (options.hang) return;

    if (options.echoAuthIn500) {
      res
        .writeHead(500, { "content-type": "text/plain" })
        .end(`upstream said: ${req.headers.authorization ?? ""}`);
      return;
    }

    // A notification carries no id and gets no body back.
    if (message.id === undefined) {
      res.writeHead(202).end();
      return;
    }

    const reply = (result: unknown) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));

    if (message.method === "initialize") {
      reply({
        protocolVersion: (message.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      });
      return;
    }
    if (message.method === "tools/list") {
      reply({ tools });
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        }),
      );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("MCP fixture server did not bind a port");
  }
  const host = `127.0.0.1:${address.port}`;
  return {
    url: `http://${host}/mcp`,
    host,
    server,
    requests,
    setTools(next: FixtureTool[]) {
      tools = next;
    },
    // Idempotent: a test that closes the fixture early to simulate an
    // unreachable server must not make the suite's own teardown throw.
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
