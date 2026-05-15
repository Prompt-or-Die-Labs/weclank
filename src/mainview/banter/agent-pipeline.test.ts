// End-to-end smoke test for the AI-agent pipeline.
//
// The unit-level pieces (BanterEngine observability, MessageQueue,
// audienceIntelligence message scoring, tool-executor policy gating,
// agentActionQueue lifecycle, VAD threshold, tool-policy defaults) are
// covered by their own test files. This file wires the pieces together
// and asserts the happy paths a streamer actually depends on:
//
//   1. A chat message injected into the bus reaches the audience
//      intelligence snapshot and every subscribed listener.
//   2. Messages from multiple platforms accumulate in history with
//      their platform stamps preserved.
//   3. A fully-autonomous agent executing a `show_overlay` tool call
//      goes through the tool-executor, runs immediately (no queue),
//      and lands on the stream-overlays surface.
//   4. A suggested-mode agent doing the same call queues the action
//      and the overlay surface stays empty until the user approves.
//   5. Approving a queued action then runs through the same path and
//      lands on the overlay surface.

import { beforeEach, describe, expect, test } from "bun:test";
import { chatBus } from "../chat/chat-bus";
import { audienceIntelligence } from "./audience-intelligence";
import { agentActionQueue } from "./action-queue";
import { executeQueuedToolAction, executeToolCalls, type ToolExecutionPolicy } from "./tool-executor";
import { streamOverlays } from "../streaming/stream-overlays";
import type { ChatMessage } from "./chat-source";

const FULL_AUTO: ToolExecutionPolicy = {
	participantId: null,
	agentName: "Director",
	autonomyLevel: "full",
	permissions: { controlOverlays: true, controlMusic: true },
};

const SUGGESTED: ToolExecutionPolicy = {
	participantId: null,
	agentName: "Director",
	autonomyLevel: "suggested",
	permissions: { controlOverlays: true, controlMusic: true },
};

function chatMessage(text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		author: overrides.author ?? "viewer-1",
		text,
		timestamp: overrides.timestamp ?? Date.now(),
		...overrides,
	};
}

beforeEach(() => {
	// Fresh state for each scenario.
	chatBus.clear();
	streamOverlays.clear();
	agentActionQueue.clear();
});

describe("AI agent pipeline — chat ingress", () => {
	test("injecting a message fans out to subscribers AND lands in history", () => {
		const received: ChatMessage[] = [];
		const unsub = chatBus.subscribe((m) => received.push(m));

		chatBus.inject(chatMessage("Hello stream!"));

		expect(received).toHaveLength(1);
		expect(received[0]?.text).toBe("Hello stream!");

		const history = chatBus.getHistory();
		expect(history).toHaveLength(1);
		expect(history[0]?.text).toBe("Hello stream!");

		unsub();
	});

	test("audience intelligence picks up an injected question", () => {
		chatBus.inject(chatMessage("What language is this written in?"));

		const snapshot = audienceIntelligence.snapshot();
		expect(snapshot.messageCount).toBeGreaterThan(0);
		// "what...?" is a question — it should land on the questions list.
		expect(snapshot.questions.length).toBeGreaterThan(0);
		expect(snapshot.questions[0]?.text).toMatch(/written/);
	});

	test("multi-platform messages preserve their platform stamps", () => {
		chatBus.inject(chatMessage("from twitch", { platform: "twitch" }));
		chatBus.inject(chatMessage("from kick", { platform: "kick" }));
		chatBus.inject(chatMessage("from youtube", { platform: "youtube" }));

		const history = chatBus.getHistory();
		expect(history.map((m) => m.platform)).toEqual(["twitch", "kick", "youtube"]);
	});

	test("clear empties history without touching subscribers", () => {
		chatBus.inject(chatMessage("doomed"));
		let received = 0;
		const unsub = chatBus.subscribe(() => received++);

		chatBus.clear();
		chatBus.inject(chatMessage("after-clear"));

		expect(received).toBe(1); // received the after-clear message
		expect(chatBus.getHistory()).toHaveLength(1);
		expect(chatBus.getHistory()[0]?.text).toBe("after-clear");
		unsub();
	});
});

describe("AI agent pipeline — tool execution", () => {
	test("full-auto policy executes show_overlay immediately (no queue)", async () => {
		expect(streamOverlays.all()).toHaveLength(0);

		const results = await executeToolCalls([
			{ id: "tc-1", name: "show_overlay", args: { kind: "notice", body: "Live!" } },
		], FULL_AUTO);

		expect(results[0]?.output).toBeTruthy();
		expect(streamOverlays.all()).toHaveLength(1);
		expect(agentActionQueue.pending()).toHaveLength(0);
	});

	test("suggested policy queues the same call without executing it", async () => {
		await executeToolCalls([
			{ id: "tc-2", name: "show_overlay", args: { kind: "notice", body: "Pending review" } },
		], SUGGESTED);

		expect(streamOverlays.all()).toHaveLength(0);
		const pending = agentActionQueue.pending();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.invocation.name).toBe("show_overlay");
	});

	test("approving a queued action executes through the same overlay path", async () => {
		const results = await executeToolCalls([
			{ id: "tc-3", name: "show_overlay", args: { kind: "lower-third", title: "Guest", subtitle: "Test" } },
		], SUGGESTED);
		const action = parseQueuedAction(results[0]?.output ?? "{}");
		expect(action.actionId).toBeTruthy();

		await executeQueuedToolAction(action.actionId);

		expect(streamOverlays.all()).toHaveLength(1);
		const stored = agentActionQueue.find(action.actionId);
		expect(stored?.status).toBe("executed");
	});

	test("disabled tool families short-circuit before the action queues", async () => {
		const results = await executeToolCalls([
			{ id: "tc-4", name: "show_overlay", args: { kind: "notice", body: "blocked" } },
		], {
			...SUGGESTED,
			permissions: { controlOverlays: false, controlMusic: true },
		});

		const output = JSON.parse(results[0]?.output ?? "{}") as Record<string, unknown>;
		expect(String(output["error"])).toContain("disabled");
		expect(agentActionQueue.pending()).toHaveLength(0);
		expect(streamOverlays.all()).toHaveLength(0);
	});
});

function parseQueuedAction(output: string): { actionId: string } {
	const parsed = JSON.parse(output) as Record<string, unknown>;
	return { actionId: String(parsed["actionId"] ?? "") };
}
