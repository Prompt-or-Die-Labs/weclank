// LLM client for the banter engine — OpenRouter or OpenAI Chat Completions
// (OpenAI-compatible JSON + tools). Keys come from the per-user secrets cache.
// User message `content` may be a string or a multimodal array for vision.

import { getStoredApiKey } from "../tts/registry";
import { getSecret } from "../auth/secrets-cache";
import { OPENAI_API_KEY } from "../auth/openai-api";
import { ApiError, ConfigError } from "../core/errors";
import { withBackoff, isRetryableStatus } from "../core/retry";
import type { BanterLlmProvider } from "../core/types";
import type { ToolDefinition } from "./tools";

/** OpenAI / OpenRouter-compatible multimodal user content. */
export type ChatMultimodalPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface ChatTurn {
	role: "system" | "user" | "assistant" | "tool";
	/** Plain string, or vision parts for `user` / some `assistant` turns. */
	content: string | ChatMultimodalPart[];
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
		content?: string | ChatMultimodalPart[] | null;
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
	private readonly apiKey: string;
	private readonly provider: BanterLlmProvider;
	private readonly serviceLabel: string;

	constructor(
		private model: string,
		opts?: { provider?: BanterLlmProvider },
	) {
		this.provider = opts?.provider ?? "openrouter";
		this.apiKey =
			this.provider === "openai"
				? getSecret(OPENAI_API_KEY)
				: getStoredApiKey("openrouter");
		if (!this.apiKey) {
			if (this.provider === "openai") {
				throw new ConfigError(
					"OpenAI API key required for this agent",
					"Settings → AI Chat & Agents → Save OpenAI API key, or set the agent’s LLM provider back to OpenRouter.",
				);
			}
			throw new ConfigError(
				"OpenRouter API key required for banter engine",
				"Add an OpenRouter API key in any agent's Voice settings — the banter engine reuses it when the LLM provider is OpenRouter.",
			);
		}
		this.serviceLabel = this.provider === "openai" ? "OpenAI" : "OpenRouter";
	}

	async respond(messages: ChatTurn[], tools?: ToolDefinition[], signal?: AbortSignal): Promise<LLMResponse> {
		const body: Record<string, unknown> = {
			model: this.model,
			messages,
			max_tokens: 400,
			temperature: 0.9,
		};
		if (tools && tools.length > 0) {
			body["tools"] = tools;
			body["tool_choice"] = "auto";
		}

		const url =
			this.provider === "openai"
				? "https://api.openai.com/v1/chat/completions"
				: "https://openrouter.ai/api/v1/chat/completions";

		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
		};
		if (this.provider === "openrouter") {
			headers["HTTP-Referer"] = "https://weclank.local";
			headers["X-Title"] = "Weclank agent chat";
		}

		const response = await withBackoff(
			async () => {
				const r = await fetch(url, {
					method: "POST",
					signal,
					headers,
					body: JSON.stringify(body),
				});
				if (!r.ok && isRetryableStatus(r.status)) {
					throw new ApiError(r.status, this.serviceLabel, r.statusText);
				}
				return r;
			},
			{ maxAttempts: 3, initialDelayMs: 400, maxDelayMs: 3_000, signal, onAttemptFailed: () => {} },
		);
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new ApiError(response.status, this.serviceLabel, detail || response.statusText);
		}
		const parsed = (await response.json()) as OpenAIResponse;
		const message = parsed.choices?.[0]?.message;
		const rawContent = message?.content;
		const text = normalizeAssistantText(rawContent).trim();
		const toolCalls: LLMToolCall[] = (message?.tool_calls ?? []).map((c) => ({
			id: c.id,
			name: c.function.name,
			args: parseArgs(c.function.arguments),
		}));
		return { text, toolCalls };
	}
}

function normalizeAssistantText(content: unknown): string {
	if (content == null) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const p of content) {
			if (p && typeof p === "object" && "type" in p && (p as { type: string }).type === "text" && "text" in p) {
				const t = (p as { text?: string }).text;
				if (typeof t === "string") parts.push(t);
			}
		}
		return parts.join("\n");
	}
	return "";
}

function parseArgs(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
