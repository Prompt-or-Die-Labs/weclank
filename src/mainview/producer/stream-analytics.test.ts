import { describe, expect, test } from "bun:test";
import type { QueuedAgentAction } from "../banter/action-queue";
import type { AudienceSnapshot } from "../banter/audience-intelligence";
import { showSegmentId } from "../core/ids";
import type { RunOfShowState } from "../core/types";
import { generatePostStreamOutput } from "./content-engine";
import { generateStreamAnalytics } from "./stream-analytics";

const AUDIENCE: AudienceSnapshot = {
	messageCount: 12,
	chatVelocity: 7,
	sentiment: { positive: 4, neutral: 3, negative: 0, label: "positive" },
	questions: [
		{ id: "q1", author: "Mina", text: "Can you show the product demo again?", timestamp: 1_000 },
	],
	flags: [],
	lastUpdated: 1_000,
};

const RUN: RunOfShowState = {
	activeSegmentId: showSegmentId("demo"),
	segments: [
		{ id: showSegmentId("open"), title: "Warm open", durationSec: 120, status: "done" },
		{ id: showSegmentId("demo"), title: "Product demo", durationSec: 300, status: "live", startedAt: 120_000 },
	],
};

const ACTIONS: QueuedAgentAction[] = [
	{
		id: "act-1",
		ts: 1,
		participantId: null,
		agentName: "Producer",
		invocation: { name: "list_overlays", args: {} },
		risk: "low",
		status: "executed",
		reason: "safe",
	},
];

describe("stream analytics", () => {
	test("builds metrics, topic engagement, and recommendations", () => {
		const transcriptEvents = [
			{ seq: 1, ts: 10_000, kind: "assistant_text", summary: "The product demo reveal landed well" },
			{ seq: 2, ts: 20_000, kind: "assistant_tool", summary: "Show overlay for product demo" },
		];
		const output = generatePostStreamOutput({
			streamTitle: "Launch stream",
			runOfShow: RUN,
			audience: AUDIENCE,
			transcriptEvents,
			now: 180_000,
		});
		const analytics = generateStreamAnalytics({
			audience: AUDIENCE,
			runOfShow: RUN,
			output,
			transcriptEvents,
			agentActions: ACTIONS,
			now: 180_000,
		});

		expect(analytics.metrics.map((metric) => metric.id)).toContain("ai-score");
		expect(analytics.topics[0]!.title).toBe("Product demo");
		expect(analytics.aiContribution.executedActions).toBe(1);
		expect(analytics.recommendations.some((line) => line.includes("viewer questions"))).toBe(true);
	});
});
