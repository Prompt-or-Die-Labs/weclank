// Executes tool calls emitted by the banter agent's LLM. Each tool returns
// a small JSON-serializable result the LLM gets as the tool message, so
// it can react ("ok, overlay shown") in its next turn.
//
// Tools live in tools.ts; this module dispatches by name and wraps the
// underlying subsystem (overlay registry, music player, music generator).

import { streamOverlays } from "../streaming/stream-overlays";
import { musicPlayer } from "../streaming/music-player";
import { generateMusic } from "../streaming/music-generator";
import { studio } from "../state/studio-store";
import { toast } from "../components/overlays";
import { mintId, overlayId, musicTrackId } from "../core/ids";
import { ToolInvocationError, userMessageFor } from "../core/errors";
import { agentActionQueue, type AgentActionRisk } from "./action-queue";
import { generateImageDataUrl } from "../openai/image-generations";
import {
	parseToolInvocation,
	type ToolInvocation,
	type ShowOverlayArgs,
	type PlayMusicArgs,
	type GenerateBroadcastImageArgs,
} from "./tools";
import type { OverlayId, ParticipantId } from "../core/ids";
import type { AgentAutonomyLevel, AgentToolPermissions } from "../core/types";
import type { OverlayPosition, StreamOverlay, StreamOverlayKind } from "../core/types";

export interface ToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface ToolResult {
	tool_call_id: string;
	output: string;
}

export interface ToolExecutionPolicy {
	participantId: ParticipantId | null;
	agentName: string;
	autonomyLevel: AgentAutonomyLevel;
	permissions: AgentToolPermissions;
}

// Short-window dedup so the LLM firing the same overlay twice in a row
// doesn't spawn two identical overlays. Keyed by (name + args JSON);
// entries older than DEDUP_WINDOW_MS are pruned lazily.
const recentInvocations = new Map<string, number>();
const DEDUP_WINDOW_MS = 4_000;

function isDuplicate(invocation: ToolInvocation): boolean {
	const key = `${invocation.name}:${JSON.stringify(invocation.args)}`;
	const now = Date.now();
	// Sweep stale entries — bounded set so no need for separate timer.
	for (const [k, ts] of recentInvocations) {
		if (now - ts > DEDUP_WINDOW_MS) recentInvocations.delete(k);
	}
	const last = recentInvocations.get(key);
	if (last != null && now - last < DEDUP_WINDOW_MS) return true;
	recentInvocations.set(key, now);
	return false;
}

export async function executeToolCalls(calls: ToolCall[], policy?: ToolExecutionPolicy): Promise<ToolResult[]> {
	const results: ToolResult[] = [];
	for (const call of calls) {
		const parsed = parseToolInvocation(call.name, call.args);
		if (!parsed.ok) {
			// Bad shape from the LLM. Ship the validation error back so it
			// can correct itself on the next turn.
			results.push({
				tool_call_id: call.id,
				output: JSON.stringify({ error: parsed.error }),
			});
			continue;
		}
		const decision = decideExecution(parsed.invocation, policy);
		if (decision.kind === "deny") {
			results.push({
				tool_call_id: call.id,
				output: JSON.stringify({ error: decision.reason }),
			});
			continue;
		}
		// `list_overlays` / `stop_music` / `set_music_volume` are pure
		// reads or idempotent state setters — skip dedup. Only dedup the
		// "creates new state" tools.
		const dedupable =
			parsed.invocation.name === "show_overlay" ||
			parsed.invocation.name === "play_music" ||
			parsed.invocation.name === "generate_broadcast_image";
		if (dedupable && isDuplicate(parsed.invocation)) {
			results.push({
				tool_call_id: call.id,
				output: JSON.stringify({ deduped: true, hint: "Identical call within 4s — skipped" }),
			});
			continue;
		}
		if (decision.kind === "queue") {
			const queued = agentActionQueue.add({
				participantId: policy?.participantId ?? null,
				agentName: policy?.agentName ?? "Agent",
				invocation: parsed.invocation,
				risk: decision.risk,
				reason: decision.reason,
			});
			results.push({
				tool_call_id: call.id,
				output: JSON.stringify({
					suggested: true,
					actionId: queued.id,
					message: "Action queued for producer approval.",
				}),
			});
			continue;
		}
		try {
			const output = await execute(parsed.invocation);
			results.push({ tool_call_id: call.id, output: JSON.stringify(output) });
		} catch (err) {
			results.push({
				tool_call_id: call.id,
				output: JSON.stringify({ error: userMessageFor(err) }),
			});
		}
	}
	return results;
}

export async function executeQueuedToolAction(id: string): Promise<unknown> {
	const action = agentActionQueue.find(id);
	if (!action) throw new ToolInvocationError("Unknown queued action");
	if (action.status !== "pending") throw new ToolInvocationError("Action is no longer pending");
	agentActionQueue.mark(id, { status: "approved" });
	try {
		const output = await execute(action.invocation);
		agentActionQueue.mark(id, { status: "executed" });
		return output;
	} catch (err) {
		const error = userMessageFor(err);
		agentActionQueue.mark(id, { status: "failed", error });
		throw err;
	}
}

function decideExecution(
	invocation: ToolInvocation,
	policy: ToolExecutionPolicy | undefined,
): { kind: "execute" } | { kind: "queue"; reason: string; risk: AgentActionRisk } | { kind: "deny"; reason: string } {
	if (!policy) return { kind: "execute" };
	if (!hasPermission(invocation, policy.permissions)) {
		return { kind: "deny", reason: `${invocation.name} is disabled for this agent.` };
	}
	const risk = riskFor(invocation);
	if (policy.autonomyLevel === "full") return { kind: "execute" };
	if (policy.autonomyLevel === "auto-safe" && risk === "low") return { kind: "execute" };
	return {
		kind: "queue",
		risk,
		reason: policy.autonomyLevel === "suggested"
			? "Suggested mode requires producer approval before acting."
			: "Auto-safe mode requires approval for medium and high risk actions.",
	};
}

function hasPermission(invocation: ToolInvocation, permissions: AgentToolPermissions): boolean {
	switch (invocation.name) {
		case "show_overlay":
		case "remove_overlay":
		case "list_overlays":
		case "generate_broadcast_image":
			return permissions.controlOverlays;
		case "play_music":
		case "stop_music":
		case "set_music_volume":
			return permissions.controlMusic;
		default: {
			const _exhaustive: never = invocation;
			void _exhaustive;
			return false;
		}
	}
}

function riskFor(invocation: ToolInvocation): AgentActionRisk {
	switch (invocation.name) {
		case "list_overlays":
		case "set_music_volume":
			return "low";
		case "show_overlay":
		case "remove_overlay":
		case "stop_music":
			return "medium";
		case "play_music":
		case "generate_broadcast_image":
			return "high";
		default: {
			const _exhaustive: never = invocation;
			void _exhaustive;
			return "medium";
		}
	}
}

async function execute(inv: ToolInvocation): Promise<unknown> {
	switch (inv.name) {
		case "show_overlay":
			return doShowOverlay(inv.args);
		case "remove_overlay": {
			const removed = streamOverlays.remove(inv.args.id);
			return { removed };
		}
		case "list_overlays":
			return {
				overlays: streamOverlays
					.all()
					.map((o) => ({ id: o.id, kind: o.kind, title: o.props.title, expiresAt: o.expiresAt })),
			};
		case "play_music":
			return doPlayMusic(inv.args);
		case "stop_music":
			musicPlayer.stop();
			studio.setCurrentMusic(null);
			return { stopped: true };
		case "set_music_volume": {
			musicPlayer.setVolume(inv.args.volume);
			studio.setMusicVolume(inv.args.volume);
			return { volume: musicPlayer.currentVolume };
		}
		case "generate_broadcast_image":
			return doGenerateBroadcastImage(inv.args);
		default: {
			const _exhaustive: never = inv;
			void _exhaustive;
			return {};
		}
	}
}

// Per-kind default lifetime when the caller doesn't specify one and the
// overlay isn't explicitly sticky. The drift problem we're guarding
// against: the LLM shows a title card, gets distracted, never removes it,
// and the card hangs around forever.
const DEFAULT_LIFETIMES: Record<StreamOverlayKind, number> = {
	"notice": 6_000,
	"title-card": 60_000,
	"code-snippet": 90_000,
	"lower-third": 120_000,
	"qr-code": 120_000,
};

const GENERATED_IMAGE_OVERLAY_MS = 180_000;

async function doGenerateBroadcastImage(
	args: GenerateBroadcastImageArgs,
): Promise<{ id: OverlayId; kind: string; revisedPrompt?: string }> {
	const { dataUrl, revisedPrompt } = await generateImageDataUrl({
		prompt: args.prompt,
		size: args.size,
	});
	const now = Date.now();
	const overlay: StreamOverlay = {
		id: mintId("ov", overlayId),
		kind: "qr-code",
		props: {
			title: args.title?.trim() || "Generated image",
			imageUrl: dataUrl,
		},
		position: "center",
		createdAt: now,
		expiresAt: now + GENERATED_IMAGE_OVERLAY_MS,
	};
	streamOverlays.add(overlay);
	return {
		id: overlay.id,
		kind: overlay.kind,
		revisedPrompt,
	};
}

function doShowOverlay(args: ShowOverlayArgs): { id: OverlayId; kind: string; expiresInMs: number | "sticky" } {
	const { kind } = args;
	const sticky = args.sticky === true;
	const position: OverlayPosition = args.position
		?? (kind === "lower-third" ? "lower-third" : kind === "notice" ? "top-right" : "center");
	const now = Date.now();
	const durationMs = sticky ? undefined : args.durationMs ?? DEFAULT_LIFETIMES[kind];
	const overlay: StreamOverlay = {
		id: mintId("ov", overlayId),
		kind,
		props: {
			title: args.title,
			subtitle: args.subtitle,
			body: args.body,
			language: args.language,
		},
		position,
		createdAt: now,
		expiresAt: durationMs ? now + durationMs : undefined,
	};
	streamOverlays.add(overlay);
	return {
		id: overlay.id,
		kind: overlay.kind,
		expiresInMs: sticky ? "sticky" : durationMs ?? 0,
	};
}

// Suno renders take 30-120s; awaiting in the tool loop would stall the
// agent's whole respond cycle. Instead we kick generation into the
// background and return immediately so the LLM can voice an expectation-
// setting line ("ok, queueing up some lo-fi — it'll fade in shortly").
// When the track is ready, we swap it in and surface a toast.
function doPlayMusic(args: PlayMusicArgs): { status: "queued"; message: string } {
	const { prompt } = args;
	if (!prompt) throw new ToolInvocationError("play_music requires a prompt");
	const instrumental = args.instrumental ?? true;
	const style = args.style;

	toast(`Queuing music: "${prompt.slice(0, 60)}…"`);

	void (async () => {
		try {
			const result = await generateMusic({ prompt, instrumental, style });
			await musicPlayer.playFromUrl(result.audioUrl, false);
			studio.setCurrentMusic({
				id: musicTrackId(result.taskId),
				title: result.title,
				prompt,
				url: result.audioUrl,
				startedAt: Date.now(),
			});
			toast(`Now playing: ${result.title}`, "success");
		} catch (err) {
			toast(`Music generation failed: ${userMessageFor(err)}`, "error");
		}
	})();

	return {
		status: "queued",
		message:
			"Music generation queued — typically 30–120 seconds. The track will crossfade in automatically when ready. Briefly tell the audience what's coming so the wait doesn't feel like dead air.",
	};
}
