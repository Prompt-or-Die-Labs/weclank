// LLM client for the banter engine — OpenRouter, OpenAI Chat Completions,
// or OpenAI Codex via ChatGPT OAuth (chatgpt.com/backend-api). All three
// speak the OpenAI-compatible JSON + tools dialect. Keys/tokens come from
// the per-user secrets cache; Codex tokens transparently refresh.
// User message `content` may be a string or a multimodal array for vision.

import { getStoredApiKey } from "../tts/registry";
import { getSecret } from "../auth/secrets-cache";
import { OPENAI_API_KEY } from "../auth/openai-api";
import {
	ensureCodexAccessToken,
	chatgptAccountId,
	isCodexConnected,
} from "../auth/openai-codex-oauth";
import { ELIZACLOUD_API_KEY } from "../auth/elizacloud-api";
import { ApiError, ConfigError } from "../core/errors";
import { withBackoff, isRetryableStatus } from "../../shared/retry";
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
	private readonly provider: BanterLlmProvider;
	private readonly serviceLabel: string;
	/** Static keys for `openai` + `openrouter`. For `openai-codex` this stays
	 * empty and we resolve a fresh access token per request (refresh-aware). */
	private readonly staticKey: string;

	constructor(
		private model: string,
		opts?: { provider?: BanterLlmProvider },
	) {
		this.provider = opts?.provider ?? "openrouter";
		switch (this.provider) {
			case "openai":
				this.staticKey = getSecret(OPENAI_API_KEY);
				this.serviceLabel = "OpenAI";
				if (!this.staticKey) {
					throw new ConfigError(
						"OpenAI API key required for this agent",
						"Settings → AI Chat & Agents → Save OpenAI API key, or set the agent’s LLM provider back to OpenRouter.",
					);
				}
				break;
			case "openai-codex":
				this.staticKey = "";
				this.serviceLabel = "ChatGPT (Codex)";
				if (!isCodexConnected()) {
					throw new ConfigError(
						"ChatGPT (Codex) not connected",
						"Settings → AI Chat & Agents → Connect ChatGPT (Codex), or change the agent's LLM provider.",
					);
				}
				break;
			case "elizacloud":
				this.staticKey = getSecret(ELIZACLOUD_API_KEY);
				this.serviceLabel = "Eliza Cloud";
				if (!this.staticKey) {
					throw new ConfigError(
						"Eliza Cloud API key required",
						"Settings → AI Chat & Agents → Connect Eliza Cloud, or change the agent's LLM provider.",
					);
				}
				break;
			default:
				this.staticKey = getStoredApiKey("openrouter");
				this.serviceLabel = "OpenRouter";
				if (!this.staticKey) {
					throw new ConfigError(
						"OpenRouter API key required for banter engine",
						"Add an OpenRouter API key in any agent's Voice settings — the banter engine reuses it when the LLM provider is OpenRouter.",
					);
				}
		}
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

		const url = pickEndpoint(this.provider);
		const apiKey = this.provider === "openai-codex" ? await ensureCodexAccessToken() : this.staticKey;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		};
		if (this.provider === "openrouter") {
			headers["HTTP-Referer"] = "https://weclank.local";
			headers["X-Title"] = "Weclank agent chat";
		}
		if (this.provider === "openai-codex") {
			// ChatGPT backend expects the chatgpt_account_id from the id_token
			// as a header. Also signal we're acting like the Codex CLI so the
			// backend routes the request through the Codex stack.
			const accountId = chatgptAccountId();
			if (accountId) headers["chatgpt-account-id"] = accountId;
			headers["OpenAI-Beta"] = "responses=experimental";
			headers["originator"] = "codex_cli_rs";
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

function pickEndpoint(provider: BanterLlmProvider): string {
	switch (provider) {
		case "openai":
			return "https://api.openai.com/v1/chat/completions";
		case "openai-codex":
			// ChatGPT backend speaks OpenAI Chat Completions at this path.
			return "https://chatgpt.com/backend-api/codex/chat/completions";
		case "elizacloud":
			return "https://elizacloud.ai/api/v1/chat/completions";
		default:
			return "https://openrouter.ai/api/v1/chat/completions";
	}
}
