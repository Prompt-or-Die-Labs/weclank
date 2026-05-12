import { describe, expect, test } from "bun:test";
import { showSegmentId } from "../core/ids";
import {
	advanceSegment,
	completedDurationSec,
	createDefaultRunOfShow,
	createSegment,
	segmentTiming,
	startSegment,
	totalDurationSec,
	updateSegment,
} from "./run-of-show";

describe("run of show", () => {
	test("starts a segment and exposes timing", () => {
		const run = createDefaultRunOfShow();
		const started = startSegment(run, showSegmentId("segment-warm-open"), 1_000);
		const active = started.segments[0]!;
		const timing = segmentTiming(active, 31_000);

		expect(started.activeSegmentId).toBe(showSegmentId("segment-warm-open"));
		expect(active.status).toBe("live");
		expect(timing.elapsedSec).toBe(30);
		expect(timing.remainingSec).toBe(90);
	});

	test("advances from the active segment to the next open segment", () => {
		const run = createDefaultRunOfShow();
		const started = startSegment(run, showSegmentId("segment-warm-open"), 1_000);
		const advanced = advanceSegment(started, 121_000);

		expect(advanced.segments[0]!.status).toBe("done");
		expect(advanced.segments[1]!.status).toBe("live");
		expect(advanced.activeSegmentId).toBe(showSegmentId("segment-main-topic"));
	});

	test("cleans title and clamps duration updates", () => {
		const run = createDefaultRunOfShow();
		const updated = updateSegment(run, showSegmentId("segment-main-topic"), {
			title: "   ",
			durationSec: 5,
		});

		expect(updated.segments[1]!.title).toBe("Untitled segment");
		expect(updated.segments[1]!.durationSec).toBe(60);
	});

	test("tracks total and completed planned duration", () => {
		const run = {
			activeSegmentId: null,
			segments: [
				{ ...createSegment("One", 120, showSegmentId("one")), status: "done" as const },
				createSegment("Two", 180, showSegmentId("two")),
			],
		};

		expect(totalDurationSec(run)).toBe(300);
		expect(completedDurationSec(run)).toBe(120);
	});
});
