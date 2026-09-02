/**
 * The bring-your-own-key driver.
 *
 * Same tool contract as the MCP connector, reached through the Messages API
 * with a key the user supplies. This exists so someone who would rather stay in
 * one window can, at the cost of paying for their own tokens; the connector
 * remains the default because it runs on a subscription they already have.
 *
 * Web search is declared here but not on the MCP path: Claude already has it
 * when the connector runs inside claude.ai, whereas an agent we drive ourselves
 * has no way to research a topic unless we give it one.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Graph } from "../graph/db";
import { CONTRACT_INSTRUCTIONS, buildTools } from "../tools/contract";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 16_000;

/** Stops a runaway loop from spending someone's money without bound. */
const MAX_ITERATIONS = 30;

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: string;
}

export interface AgentResult {
  text: string;
  toolCalls: ToolCallRecord[];
  stopReason: string | null;
  /** True when the loop hit its iteration cap rather than finishing. */
  truncated: boolean;
}

/**
 * The contract's tools, bound to a graph and made runnable by the SDK.
 *
 * The schemas go through JSON Schema rather than the SDK's `betaZodTool`
 * helper: that helper is typed against Zod 4, while the ontology compiler and
 * the MCP SDK are written against Zod 3. Converting decouples the two, so the
 * contract stays the single definition either driver reads.
 */
export function runnableTools(graph: Graph, record: ToolCallRecord[]) {
  return buildTools(graph.ontology).map((tool) => {
    const { $schema, ...inputSchema } = zodToJsonSchema(z.object(tool.inputSchema), {
      target: "openApi3",
    }) as Record<string, unknown>;

    return betaTool({
      name: tool.name,
      description: tool.description,
      inputSchema: inputSchema as { type: "object" },
      run: async (args: unknown) => {
        const input = (args ?? {}) as Record<string, unknown>;
        const result = JSON.stringify(await tool.handler(graph, input));
        record.push({ name: tool.name, input, result });
        return result;
      },
    });
  });
}

export interface AgentRequest {
  apiKey: string;
  graph: Graph;
  messages: Anthropic.Beta.BetaMessageParam[];
}

/**
 * Run one turn of the agent to completion.
 *
 * `pause_turn` needs handling explicitly: the tool runner only continues after
 * a client tool returns, so a long web-search turn would otherwise end the loop
 * and return a silently truncated answer. Pushing the paused assistant turn
 * back resumes it.
 */
export async function runAgent({ apiKey, graph, messages }: AgentRequest): Promise<AgentResult> {
  const client = new Anthropic({ apiKey });
  const toolCalls: ToolCallRecord[] = [];

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: CONTRACT_INSTRUCTIONS,
    thinking: { type: "adaptive" },
    // Route around a safety refusal rather than returning an empty answer.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    tools: [
      ...runnableTools(graph, toolCalls),
      { type: "web_search_20260209", name: "web_search", max_uses: 8 },
    ],
    messages,
    max_iterations: MAX_ITERATIONS,
  } as Anthropic.Beta.Messages.BetaToolRunnerParams);

  let last: Anthropic.Beta.BetaMessage | undefined;

  // Constructed without `stream`, so every iteration yields a complete message.
  for await (const message of runner as AsyncIterable<Anthropic.Beta.BetaMessage>) {
    last = message;
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  const text = (last?.content ?? [])
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return {
    text,
    toolCalls,
    stopReason: last?.stop_reason ?? null,
    // A turn still paused at the cap did not finish, and its answer is partial.
    truncated: last?.stop_reason === "pause_turn" || last?.stop_reason === "max_tokens",
  };
}
