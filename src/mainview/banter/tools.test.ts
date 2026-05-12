import { describe, expect, test } from "bun:test";
import { parseToolInvocation } from "./tools";

describe("parseToolInvocation", () => {
	test("rejects unknown tool name", () => {
		const result = parseToolInvocation("unicycle_dance", {});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/unknown tool/);
	});

	test("treats non-object args as empty", () => {
		const result = parseToolInvocation("show_overlay", null);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/invalid kind/);
	});

	describe("show_overlay", () => {
		test("requires a valid kind", () => {
			const bad = parseToolInvocation("show_overlay", { kind: "carousel" });
			expect(bad.ok).toBe(false);

			const good = parseToolInvocation("show_overlay", { kind: "notice", body: "hi" });
			expect(good.ok).toBe(true);
			if (good.ok && good.invocation.name === "show_overlay") {
				expect(good.invocation.args.kind).toBe("notice");
			}
		});

		test("filters invalid position to undefined rather than failing", () => {
			const result = parseToolInvocation("show_overlay", {
				kind: "title-card",
				position: "in-orbit",
			});
			expect(result.ok).toBe(true);
			if (result.ok && result.invocation.name === "show_overlay") {
				expect(result.invocation.args.position).toBeUndefined();
			}
		});

		test("durationMs only accepts finite numbers", () => {
			const result = parseToolInvocation("show_overlay", {
				kind: "notice",
				durationMs: "5000",
			});
			expect(result.ok).toBe(true);
			if (result.ok && result.invocation.name === "show_overlay") {
				expect(result.invocation.args.durationMs).toBeUndefined();
			}
			const nan = parseToolInvocation("show_overlay", { kind: "notice", durationMs: Number.NaN });
			expect(nan.ok).toBe(true);
			if (nan.ok && nan.invocation.name === "show_overlay") {
				expect(nan.invocation.args.durationMs).toBeUndefined();
			}
		});

		test("sticky must be literally true to set", () => {
			const result = parseToolInvocation("show_overlay", { kind: "notice", sticky: "yes" });
			expect(result.ok).toBe(true);
			if (result.ok && result.invocation.name === "show_overlay") {
				expect(result.invocation.args.sticky).toBe(false);
			}
		});
	});

	describe("remove_overlay", () => {
		test("requires an id", () => {
			const missing = parseToolInvocation("remove_overlay", {});
			expect(missing.ok).toBe(false);
			const bad = parseToolInvocation("remove_overlay", { id: 42 });
			expect(bad.ok).toBe(false);
		});

		test("returns the id branded", () => {
			const result = parseToolInvocation("remove_overlay", { id: "ov-7" });
			expect(result.ok).toBe(true);
			if (result.ok && result.invocation.name === "remove_overlay") {
				expect(result.invocation.args.id).toBe("ov-7" as never);
			}
		});
	});

	describe("list_overlays / stop_music", () => {
		test("dispatch with empty args", () => {
			const list = parseToolInvocation("list_overlays", {});
			expect(list.ok).toBe(true);
			const stop = parseToolInvocation("stop_music", {});
			expect(stop.ok).toBe(true);
		});
	});

	describe("play_music", () => {
		test("requires prompt", () => {
			const missing = parseToolInvocation("play_music", { style: "lofi" });
			expect(missing.ok).toBe(false);
		});

		test("instrumental only set when literally boolean", () => {
			const result = parseToolInvocation("play_music", {
				prompt: "synth pad",
				instrumental: "true",
			});
			expect(result.ok).toBe(true);
			if (result.ok && result.invocation.name === "play_music") {
				expect(result.invocation.args.instrumental).toBeUndefined();
				expect(result.invocation.args.prompt).toBe("synth pad");
			}
		});
	});

	describe("set_music_volume", () => {
		test("requires a numeric volume", () => {
			const missing = parseToolInvocation("set_music_volume", {});
			expect(missing.ok).toBe(false);
			const bad = parseToolInvocation("set_music_volume", { volume: "loud" });
			expect(bad.ok).toBe(false);
		});

		test("passes finite numbers through (clamping happens in executor)", () => {
			const result = parseToolInvocation("set_music_volume", { volume: 0.4 });
			expect(result.ok).toBe(true);
			if (result.ok && result.invocation.name === "set_music_volume") {
				expect(result.invocation.args.volume).toBe(0.4);
			}
		});
	});
});
