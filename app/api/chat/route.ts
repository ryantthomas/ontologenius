import { NextResponse } from "next/server";
import { runAgent } from "../../../src/agent/loop";
import { getGraph } from "../../../src/graph/session";

// The embedded graph needs a filesystem and a long-lived process.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bring-your-own-key endpoint.
 *
 * The key arrives with each request, is used to construct one client, and is
 * never written down: not to the graph, not to a log line, and not into the
 * error returned on failure. It lives as long as the request does.
 */
export async function POST(request: Request) {
  let body: { apiKey?: string; messages?: { role: "user" | "assistant"; content: string }[] };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "An API key is required for this mode." }, { status: 400 });
  }
  if (!body.messages?.length) {
    return NextResponse.json({ error: "No messages to send." }, { status: 400 });
  }

  try {
    const graph = await getGraph();
    const result = await runAgent({
      apiKey,
      graph,
      messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    return NextResponse.json(result);
  } catch (error) {
    // Report what failed without echoing anything that might carry the key.
    const message = error instanceof Error ? error.message : "The request failed.";
    return NextResponse.json({ error: message.replace(/sk-ant-[\w-]+/g, "[key]") }, { status: 502 });
  }
}
