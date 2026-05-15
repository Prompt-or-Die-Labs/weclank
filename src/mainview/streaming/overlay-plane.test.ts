// Tests at the interface of broadcastOverlayPlane: register / unregister /
// z-ordered draw. The plane is the test surface — we don't reach into the
// individual overlay subsystems here.

import { describe, expect, test, mock } from "bun:test";
import { broadcastOverlayPlane } from "./overlay-plane";

function noopSource(id: string, zIndex: number, drawSpy: ReturnType<typeof mock>) {
	return { id, zIndex, draw: drawSpy as unknown as (ctx: CanvasRenderingContext2D, w: number, h: number) => void };
}

function fakeCtx(): CanvasRenderingContext2D {
	let depth = 0;
	return {
		save: () => { depth++; },
		restore: () => { depth--; if (depth < 0) throw new Error("ctx.restore underflow"); },
	} as unknown as CanvasRenderingContext2D;
}

describe("BroadcastOverlayPlane", () => {
	test("z-ordered draw: smaller zIndex draws first", () => {
		const order: string[] = [];
		const sourceA = noopSource("a", 10, mock(() => { order.push("a"); }));
		const sourceB = noopSource("b", 0, mock(() => { order.push("b"); }));
		broadcastOverlayPlane.register(sourceA);
		broadcastOverlayPlane.register(sourceB);
		try {
			broadcastOverlayPlane.draw(fakeCtx(), 100, 100);
			// Default sources also draw; we only assert relative order of ours.
			const aIdx = order.indexOf("a");
			const bIdx = order.indexOf("b");
			expect(bIdx).toBeLessThan(aIdx);
		} finally {
			broadcastOverlayPlane.unregister("a");
			broadcastOverlayPlane.unregister("b");
		}
	});

	test("ties broken by registration order", () => {
		const order: string[] = [];
		broadcastOverlayPlane.register(noopSource("first", 5, mock(() => { order.push("first"); })));
		broadcastOverlayPlane.register(noopSource("second", 5, mock(() => { order.push("second"); })));
		try {
			broadcastOverlayPlane.draw(fakeCtx(), 100, 100);
			expect(order.indexOf("first")).toBeLessThan(order.indexOf("second"));
		} finally {
			broadcastOverlayPlane.unregister("first");
			broadcastOverlayPlane.unregister("second");
		}
	});

	test("re-registering the same id updates draw fn but keeps position", () => {
		const order: string[] = [];
		broadcastOverlayPlane.register(noopSource("x", 5, mock(() => { order.push("x-v1"); })));
		broadcastOverlayPlane.register(noopSource("y", 6, mock(() => { order.push("y"); })));
		broadcastOverlayPlane.register(noopSource("x", 5, mock(() => { order.push("x-v2"); })));
		try {
			broadcastOverlayPlane.draw(fakeCtx(), 100, 100);
			// only v2 of x should fire, and it should still be before y.
			expect(order).not.toContain("x-v1");
			expect(order.indexOf("x-v2")).toBeLessThan(order.indexOf("y"));
		} finally {
			broadcastOverlayPlane.unregister("x");
			broadcastOverlayPlane.unregister("y");
		}
	});

	test("unregister removes the source", () => {
		const fired: string[] = [];
		broadcastOverlayPlane.register(noopSource("temp", 99, mock(() => { fired.push("temp"); })));
		expect(broadcastOverlayPlane.ids()).toContain("temp");
		expect(broadcastOverlayPlane.unregister("temp")).toBe(true);
		expect(broadcastOverlayPlane.ids()).not.toContain("temp");
		broadcastOverlayPlane.draw(fakeCtx(), 100, 100);
		expect(fired).toEqual([]);
	});

	test("ctx.save/restore wraps every source even when one throws", () => {
		let depth = 0;
		const ctx = {
			save: () => { depth++; },
			restore: () => { depth--; },
		} as unknown as CanvasRenderingContext2D;
		broadcastOverlayPlane.register(noopSource("safe", 1, mock(() => {})));
		broadcastOverlayPlane.register({
			id: "boom",
			zIndex: 2,
			draw: () => { throw new Error("kaboom"); },
		});
		try {
			expect(() => broadcastOverlayPlane.draw(ctx, 100, 100)).toThrow("kaboom");
			expect(depth).toBe(0); // balanced even though one source threw
		} finally {
			broadcastOverlayPlane.unregister("safe");
			broadcastOverlayPlane.unregister("boom");
		}
	});

	test("default sources are registered at module load", () => {
		const ids = broadcastOverlayPlane.ids();
		expect(ids).toContain("stream-overlays");
		expect(ids).toContain("chat-overlay");
		expect(ids).toContain("captions");
		// And in the expected z-order.
		expect(ids.indexOf("stream-overlays")).toBeLessThan(ids.indexOf("chat-overlay"));
		expect(ids.indexOf("chat-overlay")).toBeLessThan(ids.indexOf("captions"));
	});
});
