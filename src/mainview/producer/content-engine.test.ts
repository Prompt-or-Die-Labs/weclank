import { describe, expect, test } from "bun:test";
import type { AudienceSnapshot } from "../banter/audience-intelligence";
import { showSegmentId } from "../core/ids";
import type { RunOfShowState } from "../core/types";
import { generatePostStreamOutput } from "./content-engine";

const AUDIENCE: AudienceSnapshot = {
	messageCount: 8,
	chatVelocity: 3,
	sentiment: { positive: 3, neutral: 1, negative: 0, label: "positive" },
	questions: [
		{ id: "q1", author: "Mina", text: "What does the pricing look like?", timestamp: 1_000 },
		{ id: "q2", author: "Rue", text: "Can you demo the overlay again?", timestamp: 2_000 },
	],
	flags: [
		{ id: "f1", author: "Bot", text: "visit https://bad.example", timestamp: 3_000, kind: "link", reason: "External link", severity: "medium" },
	],
	lastUpdated: 3_000,
};

const RUN: RunOfShowState = {
	activeSegmentId: showSegmentId("main"),
	segments: [
		{ id: showSegmentId("open"), title: "Warm open", durationSec: 120, status: "done", startedAt: 0, completedAt: 120_000 },
		{ id: showSegmentId("main"), title: "Product demo", durationSec: 300, status: "live", startedAt: 120_000 },
		{ id: showSegmentId("wrap"), title: "Wrap", durationSec: 60, status: "upcoming" },
	],
};

describe("content engine", () => {
	test("generates summary, chapters, unanswered questions, and reports", () => {
		const output = generatePostStreamOutput({
			streamTitle: "Builder stream",
			runOfShow: RUN,
			audience: AUDIENCE,
			transcriptEvents: [
				{ seq: 1, ts: 10_000, kind: "assistant_text", summary: "We built the overlay approval flow" },
				{ seq: 2, ts: 20_000, kind: "assistant_tool", summary: "Bash bun test passed" },
			],
			now: 240_000,
		});

		expect(output.title).toBe("Builder stream");
		expect(output.summary[0]).toContain("positive audience sentiment");
		expect(output.chapters.map((chapter) => chapter.timecode)).toEqual(["00:00:00", "00:02:00", "00:07:00"]);
		expect(output.unansweredQuestions[0]).toContain("pricing");
		expect(output.clipCandidates[0]!.score).toBeGreaterThanOrEqual(output.clipCandidates.at(-1)!.score);
		expect(output.sponsorReport[0]).toContain("1 sponsor/product segment");
		expect(output.moderationReport[0]).toContain("1 moderation flag");
		expect(output.newsletter).toContain("Subject: Recap - Builder stream");
		expect(output.socialPosts).toHaveLength(3);
	});

	test("falls back gracefully without transcript or audience signals", () => {
		const output = generatePostStreamOutput({
			streamTitle: "",
			runOfShow: { activeSegmentId: null, segments: [] },
			audience: { ...AUDIENCE, questions: [], flags: [], sentiment: { positive: 0, neutral: 0, negative: 0, label: "neutral" } },
			transcriptEvents: [],
			now: 1_000,
		});

		expect(output.title).toBe("Untitled stream");
		expect(output.summary[1]).toContain("No transcript events");
		expect(output.followUpTopics).toContain("Audience Q&A");
		expect(output.sponsorReport[0]).toContain("No sponsor");
	});
});
