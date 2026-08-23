import { env } from "@/lib/env";
import { BRAIN_TOOLS, runBrainTool } from "@/lib/ai/tools";

export const runtime = "nodejs";

/**
 * A Model Context Protocol endpoint, so Claude Desktop or Claude Code can query
 * this brain directly — same tools the in-app chat uses, same data.
 *
 * Point an MCP client at:  POST {APP_URL}/api/mcp
 * with header:             Authorization: Bearer {MCP_TOKEN or AUTH_SECRET}
 */

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };

function result(id: JsonRpcRequest["id"], value: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result: value });
}

function failure(id: JsonRpcRequest["id"], code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function authorized(request: Request): boolean {
  const expected = process.env.MCP_TOKEN?.trim() || env.authSecret;
  if (!expected) return true; // no secret configured — local use only
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json()) as JsonRpcRequest | JsonRpcRequest[];
  const single = Array.isArray(body) ? body[0] : body;
  const { id, method, params } = single;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "marketing-hq", version: "1.0.0" },
        instructions:
          "Marketing HQ is this consultant's own record: clients, projects, tasks, captured insights, and connected GA4 / Meta / LinkedIn / Google Ads data. Query it before answering anything about their work — it is the source of truth, and it is private.",
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, {
        tools: BRAIN_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.input_schema,
        })),
      });

    case "tools/call": {
      const name = params?.name as string;
      if (!BRAIN_TOOLS.some((tool) => tool.name === name)) return failure(id, -32602, `Unknown tool: ${name}`);

      try {
        const output = await runBrainTool(name, (params?.arguments ?? {}) as Record<string, any>);
        return result(id, { content: [{ type: "text", text: output.text }], isError: false });
      } catch (error) {
        return result(id, {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        });
      }
    }

    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

export async function GET() {
  return Response.json({
    name: "marketing-hq",
    protocolVersion: PROTOCOL_VERSION,
    transport: "http",
    tools: BRAIN_TOOLS.map((t) => t.name),
  });
}
