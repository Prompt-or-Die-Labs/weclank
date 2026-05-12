// LLM client for the banter engine. Calls OpenRouter's text
// /chat/completions and supports OpenAI-style tool calling so the agent
// can drive overlays + music. Reuses the OpenRouter API key the user
// already stored for TTS.

import { getStoredApiKey } from "../tts/registry";
import { ApiError, ConfigError } from "../core/errors";
import { withBackoff, isRetryableStatus } from "../core/retry";
import type { ToolDefinition } from "./tools";

export interface ChatTurn {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	/** Required when role is "tool" — references the tool_call that produced this. */
	tool_call_id?: string;
	/** Echoed back when an assistant turn issued tool calls. */
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
}

export interface LLMToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface LLMResponse {
	text: string;
	toolCalls: LLMToolCall[];
}

interface OpenAIResponseChoice {
	message?: {
		content?: string | null;
		tool_calls?: Array<{
			id: string;
			type: string;
			function: { name: string; arguments: string };
		}>;
	};
}

interface OpenAIResponse {
	choices?: OpenAIResponseChoice[];
}

export class LLMClient {
	constructor(
		private model: string,
		/** Optional override. Falls back to the stored OpenRouter TTS key. */
		private apiKey: string = getStoredApiKey("openrouter"),
	) {
		if (!this.apiKey) throw new ConfigError("OpenRouter API key required for banter engine", "Add an OpenRouter API key in any agent's Voice settings — the banter engine reuses it.");
	}

	async respond(messages: ChatTurn[], tools?: ToolDefinition[], signal?: AbortSignal): Promise<LLMResponse> {
		const body: Record<string, unknown> = {
			model: this.model,
			messages,
			max_tokens: 280,
			temperature: 0.9,
		};
		if (tools && tools.length > 0) {
			body["tools"] = tools;
			body["tool_choice"] = "auto";
		}

		// Retry transient failures (429 rate limits, 5xx server hiccups).
		// Hard 4xx errors throw immediately — backoff won't fix them.
		const response = await withBackoff(
			async () => {
				const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
					method: "POST",
					signal,
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
						"HTTP-Referer": "https://weclank.local",
						"X-Title": "Weclank agent chat",
					},
					body: JSON.stringify(body),
				});
				if (!r.ok && isRetryableStatus(r.status)) {
					throw new ApiError(r.status, "OpenRouter", r.statusText);
				}
				return r;
			},
			{ maxAttempts: 3, initialDelayMs: 400, maxDelayMs: 3_000, signal, onAttemptFailed: () => {} },
		);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new ApiError(response.status, "OpenRouter", detail || response.statusText);
		}
		const parsed = (await response.json()) as OpenAIResponse;
		const message = parsed.choices?.[0]?.message;
		const text = (message?.content ?? "").trim();
		const toolCalls: LLMToolCall[] = (message?.tool_calls ?? []).map((c) => ({
			id: c.id,
			name: c.function.name,
			args: parseArgs(c.function.arguments),
		}));
		return { text, toolCalls };
	}
}

function parseArgs(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
