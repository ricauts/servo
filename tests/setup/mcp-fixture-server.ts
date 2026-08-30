// tests/setup/mcp-fixture-server.ts (cnp-02) — an IN-PROCESS MCP server bound
// to 127.0.0.1 on an ephemeral port, torn down with the test. No external
// network, no docker, no second process.
//
// It is built on the same adopted SDK the client uses (`@modelcontextprotocol/
// sdk`, MIT), low-level `Server` rather than the high-level `McpServer`, so a
// test can dictate the exact `tools/list` payload — names, descriptions,
// inputSchemas and annotations — and change it between syncs to drive the
// hash-drift re-quarantine.
//
// Stateless mode (`sessionIdGenerator: undefined`) with `enableJsonResponse`
// so each POST is one request and one JSON response: the client under test is
// a sync job, not a long-lived session.

import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface FixtureTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Closed set in the protocol: readOnlyHint, destructiveHint, … */
  annotations?: Record<string, unknown>;
  /** The protocol's passthrough bag — where a vendor risk level travels. */
  _meta?: Record<string, unknown>;
}

export interface McpFixture {
  /** http://127.0.0.1:<port>/mcp */
  url: string;
  port: number;
  /** Every Authorization header the fixture saw, in arrival order. */
  authHeaders: (string | undefined)[];
  /** Swap the advertised tool list — the drift lever. */
  setTools(tools: FixtureTool[]): void;
  close(): Promise<void>;
}

export async function startMcpFixture(initial: FixtureTool[] = []): Promise<McpFixture> {
  let tools = initial;
  const authHeaders: (string | undefined)[] = [];

  const http: HttpServer = createServer((req, res) => {
    authHeaders.push(req.headers.authorization);

    // A fresh Server + transport per request: stateless is the v1 contract on
    // both sides, and it keeps one test's session out of the next one's.
    const server = new Server(
      { name: "fixture", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    void server
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (address === null || typeof address === "string") {
    throw new Error("MCP fixture server did not bind a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    port: address.port,
    authHeaders,
    setTools(next: FixtureTool[]) {
      tools = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        http.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
