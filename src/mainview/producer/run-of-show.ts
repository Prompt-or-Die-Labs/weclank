import { showSegmentId, type ShowSegmentId } from "../core/ids";
import type { RunOfShowState, ShowSegment } from "../core/types";

export interface SegmentTiming {
	elapsedSec: number;
	remainingSec: number;
	overrunSec: number;
	progress: number;
	overrun: boolean;
}

export function createDefaultRunOfShow(): RunOfShowState {
	return {
		activeSegmentId: null,
		segments: [
			createSegment("Warm open", 120, showSegmentId("segment-warm-open")),
			createSegment("Main topic", 720, showSegmentId("segment-main-topic")),
			createSegment("Audience Q&A", 360, showSegmentId("segment-audience-qa")),
			createSegment("Wrap", 120, showSegmentId("segment-wrap")),
		],
	};
}

export function createSegment(title: string, durationSec: number, id: ShowSegmentId): ShowSegment {
	return {
		id,
		title: cleanTitle(title),
		durationSec: cleanDuration(durationSec),
		status: "upcoming",
	};
}

export function updateSegment(
	runOfShow: RunOfShowState,
	id: ShowSegmentId,
	patch: Partial<Pick<ShowSegment, "title" | "durationSec" | "notes">>,
): RunOfShowState {
	return {
		...runOfShow,
		segments: runOfShow.segments.map((segment) => {
			if (segment.id !== id) return segment;
			return {
				...segment,
				...(patch.title !== undefined ? { title: cleanTitle(patch.title) } : {}),
				...(patch.durationSec !== undefined ? { durationSec: cleanDuration(patch.durationSec) } : {}),
				...(patch.notes !== undefined ? { notes: patch.notes.trim() || undefined } : {}),
			};
		}),
	};
}

export function addSegment(runOfShow: RunOfShowState, segment: ShowSegment): RunOfShowState {
	return {
		...runOfShow,
		segments: [...runOfShow.segments, segment],
	};
}

export function removeSegment(runOfShow: RunOfShowState, id: ShowSegmentId): RunOfShowState {
	return {
		activeSegmentId: runOfShow.activeSegmentId === id ? null : runOfShow.activeSegmentId,
		segments: runOfShow.segments.filter((segment) => segment.id !== id),
	};
}

export function startSegment(runOfShow: RunOfShowState, id: ShowSegmentId, now: number): RunOfShowState {
	if (!runOfShow.segments.some((segment) => segment.id === id)) return runOfShow;
	return {
		activeSegmentId: id,
		segments: runOfShow.segments.map((segment) => {
			if (segment.id === id) {
				return {
					...segment,
					status: "live",
					startedAt: now,
					completedAt: undefined,
				};
			}
			if (segment.status === "live") {
				return {
					...segment,
					status: "done",
					completedAt: now,
				};
			}
			return segment;
		}),
	};
}

export function completeSegment(runOfShow: RunOfShowState, id: ShowSegmentId, now: number): RunOfShowState {
	return {
		activeSegmentId: runOfShow.activeSegmentId === id ? null : runOfShow.activeSegmentId,
		segments: runOfShow.segments.map((segment) => (
			segment.id === id
				? { ...segment, status: "done", completedAt: now }
				: segment
		)),
	};
}

export function advanceSegment(runOfShow: RunOfShowState, now: number): RunOfShowState {
	const activeIndex = runOfShow.segments.findIndex((segment) => segment.id === runOfShow.activeSegmentId);
	if (activeIndex >= 0) {
		const next = runOfShow.segments.slice(activeIndex + 1).find((segment) => segment.status !== "done");
		const completed = completeSegment(runOfShow, runOfShow.segments[activeIndex]!.id, now);
		return next ? startSegment(completed, next.id, now) : completed;
	}
	const first = runOfShow.segments.find((segment) => segment.status !== "done");
	return first ? startSegment(runOfShow, first.id, now) : runOfShow;
}

export function segmentTiming(segment: ShowSegment, now: number): SegmentTiming {
	const startedAt = segment.startedAt ?? now;
	const elapsedSec = segment.status === "live"
		? Math.max(0, Math.floor((now - startedAt) / 1000))
		: 0;
	const remainingSec = Math.max(0, segment.durationSec - elapsedSec);
	const overrunSec = Math.max(0, elapsedSec - segment.durationSec);
	const progress = segment.durationSec <= 0 ? 1 : Math.min(1, elapsedSec / segment.durationSec);
	return {
		elapsedSec,
		remainingSec,
		overrunSec,
		progress,
		overrun: overrunSec > 0,
	};
}

export function totalDurationSec(runOfShow: RunOfShowState): number {
	return runOfShow.segments.reduce((sum, segment) => sum + segment.durationSec, 0);
}

export function completedDurationSec(runOfShow: RunOfShowState): number {
	return runOfShow.segments.reduce((sum, segment) => (
		segment.status === "done" ? sum + segment.durationSec : sum
	), 0);
}

function cleanTitle(title: string): string {
	const trimmed = title.replace(/\s+/g, " ").trim();
	return trimmed || "Untitled segment";
}

function cleanDuration(durationSec: number): number {
	if (!Number.isFinite(durationSec)) return 300;
	return Math.min(4 * 60 * 60, Math.max(60, Math.round(durationSec)));
}
