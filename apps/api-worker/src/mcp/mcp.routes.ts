/**
 * `/mcp` endpoint (change seo-aeo-agent-surfaces, spec agent-tool-surface)
 * — the MCP streamable-HTTP surface over the closed read-only tool set
 * (src/mcp/tools.ts).
 *
 * SDK path (design D5, implementation note): the Cloudflare `agents` SDK
 * was evaluated and set aside — it peers on zod ^4 while this worker's
 * DTO layer pins zod ^3.25, its McpAgent requires a new Durable Object
 * class + SQLite migration + per-session DO state for what is a stateless
 * read-only endpoint, and its `cloudflare:workers`-based classes do not
 * run under this repo's Node-pool vitest harness. The official
 * `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport`
 * (the SDK's documented Cloudflare-Workers route, used with the
 * low-level `Server`) mounts INSIDE this Hono app instead — so /mcp sits
 * behind the exact same middleware chain as every other path and needs
 * no wrangler/DO changes.
 *
 * Boundary contract (spec "Age-gate semantics preserved at the tool
 * boundary"): the enforcement point is this endpoint, exactly like the
 * public routes —
 *
 *   requireRateLimit('MCP') → ageGate() → MCP handler
 *
 * house order (Nest RateLimitGuard-runs-first parity). A confirmed
 * session rides through to the tools; an unconfirmed caller receives the
 * age-gate contract error (403, code AGE_GATE_REQUIRED / _FAILED) for
 * every MCP method — initialize, tools/list, tools/call alike — and
 * never any tool metadata or figures. The tool layer adds no bypass.
 *
 * Transport mode: stateless (`sessionIdGenerator` unset — the transport
 * requires a fresh transport per request in this mode) with plain JSON
 * responses (`enableJsonResponse`), matching the stateless read-only
 * surface; no session state is stored anywhere. POST is the only
 * registered method — the stateless-JSON surface has no server-initiated
 * stream to listen on, so GET/DELETE fall through to the house 404
 * envelope like every other path's unsupported method.
 *
 * @module McpRoutes
 */

import { Hono, type Context } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { AppEnv } from '../env';
import { ageGate } from '../middleware/age-gate';
import { requireRateLimit } from '../middleware/rate-limit';
import {
  dispatchMcpTool,
  MCP_SERVER_INFO,
  MCP_TOOLS,
} from './tools';

/** The MCP HTTP surface — stateless JSON request/response, POST only. */
const MCP_METHOD = 'POST' as const;

/**
 * One request, one transport + server pair (stateless-mode requirement):
 * tools/list serves the pinned closed set; tools/call dispatches through
 * the closed-set check. Unknown JSON-RPC methods are rejected by the SDK
 * protocol layer; unknown TOOL names are rejected by the dispatch check
 * with the contract error naming the valid tools.
 */
async function handleMcp(c: Context<AppEnv>): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = new Server(
    { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version },
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INFO.title },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MCP_TOOLS,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const payload = await dispatchMcpTool(name, args ?? {}, c.env.DB);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      };
    } catch (err) {
      // Contract-level rejections (unknown tool, invalid arguments) keep
      // their JSON-RPC error shape; domain errors (product not found,
      // classification gate, no published allowances) surface as tool
      // execution errors with the routes' exact messages — no figures
      // beyond the error text, never a partial result.
      if (err instanceof McpError) {
        throw err;
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: err instanceof Error ? err.message : 'Tool execution failed',
          },
        ],
        isError: true,
      };
    }
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    // Stateless JSON mode completes the response inside handleRequest;
    // closing releases the per-request transport deterministically.
    await server.close();
  }
}

/** Register the /mcp boundary: house rate limit → age gate → MCP handler. */
export function registerMcpRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.use('/mcp', requireRateLimit('MCP'));
  app.on(MCP_METHOD, '/mcp', ageGate());
  app.on(MCP_METHOD, '/mcp', handleMcp);
  return app;
}
