// Tool definitions for the banter agent. Shape mirrors OpenAI's
// `tools: [{type: "function", function: {...}}]` format which OpenRouter
// passes through verbatim.
//
// Adding a new tool:
//   1. Add an entry to `BANTER_TOOLS` below describing the schema.
//   2. Extend the `ToolInvocation` discriminated union with the typed args.
//   3. Add a case to `parseToolInvocation` that validates raw args.
//   4. Add a case in `tool-executor.ts::execute`.

import type { OverlayId } from "../core/ids";
import type { OverlayPosition, StreamOverlayKind } from "../core/types";

export interface ToolDefinition {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: {
			type: "object";
			properties: Record<string, unknown>;
			required?: string[];
			additionalProperties?: boolean;
		};
	};
}

export const OVERLAY_KINDS: StreamOverlayKind[] = ["title-card", "notice", "code-snippet", "lower-third"];
export const OVERLAY_POSITIONS: OverlayPosition[] = [
	"bottom-left",
	"bottom-right",
	"top-left",
	"top-right",
	"center",
	"lower-third",
];

export const BANTER_TOOLS: ToolDefinition[] = [
	{
		type: "function",
		function: {
			name: "show_overlay",
			description:
				"Render a graphic on the broadcast — a title card, transient notice, code snippet, or lower-third name plate. Use sparingly; one overlay at a time at most. All overlays auto-dismiss after a default lifetime unless you set sticky=true (e.g. a name plate that should stay up for the whole segment).",
			parameters: {
				type: "object",
				properties: {
					kind: { type: "string", enum: OVERLAY_KINDS, description: "Overlay type." },
					title: { type: "string", description: "Headline / name." },
					subtitle: { type: "string", description: "Smaller secondary text." },
					body: { type: "string", description: "Multi-line body (for code-snippet, the code; for notice, the message)." },
					language: { type: "string", description: "Code language label (code-snippet only)." },
					position: {
						type: "string",
						enum: OVERLAY_POSITIONS,
						description: "Where on the canvas to anchor.",
					},
					durationMs: {
						type: "number",
						description: "Custom auto-dismiss in ms. Defaults: notice=6s, others=60s. Ignored when sticky=true.",
					},
					sticky: {
						type: "boolean",
						description: "If true, the overlay stays until you call remove_overlay. Reserve for whole-segment graphics (name plate during an interview, etc.). Default false.",
					},
				},
				required: ["kind"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "remove_overlay",
			description: "Take down a previously-shown overlay by its id.",
			parameters: {
				type: "object",
				properties: { id: { type: "string" } },
				required: ["id"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "list_overlays",
			description: "Get the ids and kinds of currently-visible overlays so you can update or remove them.",
			parameters: { type: "object", properties: {} },
		},
	},
	{
		type: "function",
		function: {
			name: "play_music",
			description:
				"Generate and play background music from a prompt. Takes 30–120 seconds to render. Crossfades from the previous track. Default: instrumental.",
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string", description: "Music description, e.g. 'lo-fi piano, mellow, 80 bpm'." },
					instrumental: { type: "boolean", description: "Default true — vocals fight your speech." },
					style: { type: "string", description: "Optional style hint." },
				},
				required: ["prompt"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "stop_music",
			description: "Fade out the currently playing background music.",
			parameters: { type: "object", properties: {} },
		},
	},
	{
		type: "function",
		function: {
			name: "set_music_volume",
			description: "Set background music volume on a 0–1 scale. Use 0.2–0.4 while you're talking, higher when you're not.",
			parameters: {
				type: "object",
				properties: { volume: { type: "number", minimum: 0, maximum: 1 } },
				required: ["volume"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "generate_broadcast_image",
			description:
				"Generate a still image via OpenAI Images (DALL-E 3) using the user's saved OpenAI API key, and show it on the broadcast as a picture overlay (same slot as QR graphics). Use for stream graphics, memes, or illustrated explanations. Costs API credits — use sparingly.",
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string", description: "What to generate — be specific and safe for broadcast." },
					size: {
						type: "string",
						enum: ["1024x1024", "1792x1024", "1024x1792"],
						description: "Canvas shape. Default 1024x1024.",
					},
					title: { type: "string", description: "Short caption under the image (optional)." },
				},
				required: ["prompt"],
			},
		},
	},
];

// Typed shapes the executor sees after `parseToolInvocation` validates the
// raw JSON the LLM sent. Anything optional in the schema lands here as
// `undefined`-able; required fields are guaranteed to be present.

export interface ShowOverlayArgs {
	kind: StreamOverlayKind;
	title?: string;
	subtitle?: string;
	body?: string;
	language?: string;
	position?: OverlayPosition;
	durationMs?: number;
	sticky?: boolean;
}
export interface PlayMusicArgs {
	prompt: string;
	instrumental?: boolean;
	style?: string;
}

export interface GenerateBroadcastImageArgs {
	prompt: string;
	size?: "1024x1024" | "1792x1024" | "1024x1792";
	title?: string;
}

export type ToolInvocation =
	| { name: "show_overlay"; args: ShowOverlayArgs }
	| { name: "remove_overlay"; args: { id: OverlayId } }
	| { name: "list_overlays"; args: Record<string, never> }
	| { name: "play_music"; args: PlayMusicArgs }
	| { name: "stop_music"; args: Record<string, never> }
	| { name: "set_music_volume"; args: { volume: number } }
	| { name: "generate_broadcast_image"; args: GenerateBroadcastImageArgs };

export type ParseResult =
	| { ok: true; invocation: ToolInvocation }
	| { ok: false; error: string };

/** Validate a tool-call from the LLM. Returns a discriminated invocation or
 * a human-readable error string the executor can ship back to the model. */
export function parseToolInvocation(name: string, raw: unknown): ParseResult {
	const args = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
	switch (name) {
		case "show_overlay": {
			const kind = args["kind"];
			if (!isOverlayKind(kind)) return fail(`show_overlay: invalid kind: ${String(kind)}`);
			return ok({
				name,
				args: {
					kind,
					title: stringOr(args["title"]),
					subtitle: stringOr(args["subtitle"]),
					body: stringOr(args["body"]),
					language: stringOr(args["language"]),
					position: isOverlayPosition(args["position"]) ? args["position"] : undefined,
					durationMs: numberOr(args["durationMs"]),
					sticky: args["sticky"] === true,
				},
			});
		}
		case "remove_overlay": {
			const id = stringOr(args["id"]);
			if (!id) return fail("remove_overlay: missing id");
			return ok({ name, args: { id: id as OverlayId } });
		}
		case "list_overlays":
			return ok({ name, args: {} });
		case "play_music": {
			const prompt = stringOr(args["prompt"]);
			if (!prompt) return fail("play_music: missing prompt");
			return ok({
				name,
				args: {
					prompt,
					instrumental: typeof args["instrumental"] === "boolean" ? args["instrumental"] : undefined,
					style: stringOr(args["style"]),
				},
			});
		}
		case "stop_music":
			return ok({ name, args: {} });
		case "set_music_volume": {
			const volume = numberOr(args["volume"]);
			if (volume === undefined) return fail("set_music_volume: missing or invalid volume");
			return ok({ name, args: { volume } });
		}
		case "generate_broadcast_image": {
			const prompt = stringOr(args["prompt"]);
			if (!prompt) return fail("generate_broadcast_image: missing prompt");
			const size = args["size"];
			const okSize =
				size === "1024x1024" || size === "1792x1024" || size === "1024x1792" ? size : undefined;
			return ok({
				name,
				args: { prompt, size: okSize, title: stringOr(args["title"]) },
			});
		}
		default:
			return fail(`unknown tool: ${name}`);
	}
}

function ok(invocation: ToolInvocation): ParseResult { return { ok: true, invocation }; }
function fail(error: string): ParseResult { return { ok: false, error }; }
function stringOr(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}
function numberOr(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function isOverlayKind(v: unknown): v is StreamOverlayKind {
	return typeof v === "string" && OVERLAY_KINDS.includes(v as StreamOverlayKind);
}
function isOverlayPosition(v: unknown): v is OverlayPosition {
	return typeof v === "string" && OVERLAY_POSITIONS.includes(v as OverlayPosition);
}
