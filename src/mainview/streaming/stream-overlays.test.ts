import { afterEach, describe, expect, test } from "bun:test";
import { streamOverlays } from "./stream-overlays";
import { overlayId } from "../core/ids";
import type { StreamOverlay } from "../core/types";

function makeOverlay(idTag: string, expiresAt?: number): StreamOverlay {
	return {
		id: overlayId(idTag),
		kind: "title-card",
		props: { title: idTag },
		position: "center",
		createdAt: Date.now(),
		expiresAt,
	};
}

describe("streamOverlays registry", () => {
	afterEach(() => {
		streamOverlays.clear();
	});

	test("add returns the overlay and stores it", () => {
		const overlay = streamOverlays.add(makeOverlay("ov-1"));
		expect(overlay.id).toBe(overlayId("ov-1"));
		expect(streamOverlays.all().map((o) => o.id)).toContain(overlayId("ov-1"));
	});

	test("update merges props, returns the updated overlay", () => {
		streamOverlays.add(makeOverlay("ov-2"));
		const result = streamOverlays.update(overlayId("ov-2"), { subtitle: "new" });
		expect(result).not.toBeNull();
		expect(result!.props.title).toBe("ov-2");
		expect(result!.props.subtitle).toBe("new");
	});

	test("update returns null when the id doesn't exist", () => {
		expect(streamOverlays.update(overlayId("not-there"), { title: "x" })).toBeNull();
	});

	test("remove returns true on hit, false on miss", () => {
		streamOverlays.add(makeOverlay("ov-3"));
		expect(streamOverlays.remove(overlayId("ov-3"))).toBe(true);
		expect(streamOverlays.remove(overlayId("ov-3"))).toBe(false);
	});

	test("tick prunes only expired overlays", () => {
		const now = Date.now();
		streamOverlays.add(makeOverlay("perm")); // no expiry
		streamOverlays.add(makeOverlay("soon", now + 100));
		streamOverlays.add(makeOverlay("stale", now - 100));
		streamOverlays.tick(now);
		const ids = streamOverlays.all().map((o) => o.id);
		expect(ids).toContain(overlayId("perm"));
		expect(ids).toContain(overlayId("soon"));
		expect(ids).not.toContain(overlayId("stale"));
	});

	test("clear empties everything", () => {
		streamOverlays.add(makeOverlay("a"));
		streamOverlays.add(makeOverlay("b"));
		streamOverlays.clear();
		expect(streamOverlays.all()).toHaveLength(0);
	});
});
