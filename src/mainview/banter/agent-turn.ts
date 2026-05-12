import type { LLMClient, ChatTurn, LLMResponse } from "./llm-client";
import { BANTER_TOOLS } from "./tools";
import { executeToolCalls, type ToolCall } from "./tool-executor";

export interface AgentToolCallRecord {
	ts: number;
	name: string;
	args: Record<string, unknown>;
	ok: boolean;
	error?: string;
}

export async function runAgentToolLoop(args: {
	llm: Pick<LLMClient, "respond">;
	systemContent: string;
	history: ChatTurn[];
	signal: AbortSignal;
	onTextReady(): void;
	onToolCall(record: AgentToolCallRecord): void;
}): Promise<string> {
	let messages: ChatTurn[] = [{ role: "system", content: args.systemContent }, ...args.history];
	for (let iter = 0; iter < 4; iter++) {
		if (args.signal.aborted) return "";
		const result: LLMResponse = await args.llm.respond(messages, BANTER_TOOLS, args.signal);
		if (args.signal.aborted) return "";
		if (result.toolCalls.length === 0) {
			if (result.text) args.onTextReady();
			return result.text;
		}
		messages = [
			...messages,
			{
				role: "assistant",
				content: result.text ?? "",
				tool_calls: result.toolCalls.map((call) => ({
					id: call.id,
					type: "function" as const,
					function: { name: call.name, arguments: JSON.stringify(call.args) },
				})),
			},
		];
		const calls: ToolCall[] = result.toolCalls.map((call) => ({
			id: call.id,
			name: call.name,
			args: call.args,
		}));
		const toolResults = await executeToolCalls(calls);
		for (let i = 0; i < calls.length; i++) {
			const call = calls[i]!;
			const output = toolResults[i];
			const parsed = parseToolOutput(output?.output ?? "");
			args.onToolCall({
				ts: Date.now(),
				name: call.name,
				args: call.args,
				ok: !parsed.error,
				error: parsed.error?.slice(0, 120),
			});
		}
		for (const result of toolResults) {
			messages.push({ role: "tool", tool_call_id: result.tool_call_id, content: result.output });
		}
	}
	return "";
}

export function parseToolOutput(raw: string): { error?: string } {
	if (!raw) return {};
	try {
		const value = JSON.parse(raw) as Record<string, unknown>;
		if (value && typeof value === "object" && "error" in value) {
			const error = value["error"];
			return { error: typeof error === "string" ? error : "tool error" };
		}
		return {};
	} catch {
		return {};
	}
}
