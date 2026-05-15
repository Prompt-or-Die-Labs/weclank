import { beforeEach, describe, expect, test } from "bun:test";
import { AudioMixer } from "./audio-mixer";

// We instantiate a fresh AudioMixer per test rather than using the
// singleton — other tests (`participant-runtime.test.ts`,
// `source-factory.test.ts`) use `mock.module` to replace the singleton
// process-wide, which is irreversible in Bun. A local class instance is
// immune to that pollution.

describe("audio-mixer — per-source sync offset", () => {
	let mixer: AudioMixer;
	beforeEach(() => { mixer = new AudioMixer(); });

	test("addInput with syncOffsetMs sets the delay", () => {
		mixer.addInput("a", new MediaStream(), { syncOffsetMs: 120 });
		expect(mixer.getSyncOffset("a")).toBe(120);
	});

	test("default sync offset is 0 when not specified", () => {
		mixer.addInput("b", new MediaStream());
		expect(mixer.getSyncOffset("b")).toBe(0);
	});

	test("setSyncOffset updates live", () => {
		mixer.addInput("c", new MediaStream());
		mixer.setSyncOffset("c", 80);
		expect(mixer.getSyncOffset("c")).toBe(80);
		mixer.setSyncOffset("c", 200);
		expect(mixer.getSyncOffset("c")).toBe(200);
	});

	test("offset is clamped to [0, 1000]ms", () => {
		mixer.addInput("d", new MediaStream(), { syncOffsetMs: -50 });
		expect(mixer.getSyncOffset("d")).toBe(0);
		mixer.setSyncOffset("d", 9999);
		expect(mixer.getSyncOffset("d")).toBe(1000);
	});

	test("getSyncOffset returns 0 for unknown participant", () => {
		expect(mixer.getSyncOffset("does-not-exist")).toBe(0);
	});

	test("setSyncOffset on unknown participant is a no-op (no throw)", () => {
		expect(() => mixer.setSyncOffset("does-not-exist", 50)).not.toThrow();
	});
});
