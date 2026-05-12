import { afterEach, describe, expect, test } from "bun:test";
import { transcriptFeed } from "./feed";

interface Event {
	seq: number;
	ts: number;
	kind: string;
	summary: string;
}

function ev(seq: number, kind: string, summary: string): Event {
	return { seq, ts: Date.now(), kind, summary };
}

describe("transcriptFeed", () => {
	afterEach(() => {
		transcriptFeed.__seedForTesting([]);
	});

	test("currentMaxSeq is 0 on an empty feed", () => {
		transcriptFeed.__seedForTesting([]);
		expect(transcriptFeed.currentMaxSeq()).toBe(0);
	});

	test("currentMaxSeq returns the highest seq in the ring", () => {
		transcriptFeed.__seedForTesting([
			ev(1, "assistant_text", "first"),
			ev(2, "assistant_tool", "Edit foo.ts"),
			ev(7, "assistant_text", "later"),
		]);
		expect(transcriptFeed.currentMaxSeq()).toBe(7);
	});

	test("recentSummaries returns the last N tagged for the LLM", () => {
		transcriptFeed.__seedForTesting([
			ev(1, "assistant_text", "alpha"),
			ev(2, "assistant_tool", "Edit a.ts"),
			ev(3, "assistant_text", "beta"),
		]);
		const summaries = transcriptFeed.recentSummaries(2);
		expect(summaries).toEqual([
			"- [tool] Edit a.ts",
			"- [said] beta",
		]);
	});

	test("summariesSince filters by seq > threshold", () => {
		transcriptFeed.__seedForTesting([
			ev(1, "assistant_text", "old"),
			ev(2, "assistant_tool", "Bash npm test"),
			ev(3, "assistant_text", "new"),
		]);
		const since1 = transcriptFeed.summariesSince(1);
		expect(since1).toEqual([
			"- [tool] Bash npm test",
			"- [said] new",
		]);
		expect(transcriptFeed.summariesSince(99)).toEqual([]);
	});

	test("eventsSnapshot returns recent typed events without formatting", () => {
		transcriptFeed.__seedForTesting([
			ev(1, "assistant_text", "old"),
			ev(2, "assistant_tool", "Bash bun test"),
			ev(3, "assistant_text", "new"),
		]);
		expect(transcriptFeed.eventsSnapshot(2).map((event) => event.summary)).toEqual([
			"Bash bun test",
			"new",
		]);
	});

	test("unknown kinds get the [event] tag", () => {
		transcriptFeed.__seedForTesting([ev(1, "weird_kind", "x")]);
		expect(transcriptFeed.recentSummaries()).toEqual(["- [event] x"]);
	});
});
