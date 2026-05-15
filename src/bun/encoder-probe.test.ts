// Real-ffmpeg probe tests. Verifies the open-session probe by
// running the actual probe pattern against ffmpeg + asserting that:
//   - libx264 (always-works software encoder) passes
//   - A deliberately broken encoder spec (impossible flag) fails
//
// We can't unit-test `detectVideoEncoder` directly because it caches
// at module-load time; instead we duplicate the probe shape and
// exercise it against the real binary.

import { describe, expect, test } from "bun:test";
import { augmentedProcessEnv } from "./ffmpeg-env";

const HAS_FFMPEG = await (async (): Promise<boolean> => {
	try {
		const p = Bun.spawn(["ffmpeg", "-version"], { stdout: "pipe", stderr: "pipe", env: augmentedProcessEnv() });
		return (await p.exited) === 0;
	} catch {
		return false;
	}
})();

async function probe(name: string, extraArgs: string[]): Promise<{ ok: boolean; code: number; stderr: string }> {
	const args = [
		"ffmpeg",
		"-hide_banner",
		"-loglevel", "error",
		"-f", "lavfi",
		"-i", "color=size=64x64:rate=1",
		"-t", "0.1",
		"-c:v", name,
		...extraArgs,
		"-f", "null", "-",
	];
	const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe", env: augmentedProcessEnv() });
	const stderrPromise = new Response(proc.stderr).text();
	const code = await Promise.race([
		proc.exited,
		new Promise<number>((resolve) => setTimeout(() => {
			try { proc.kill("SIGKILL"); } catch { /* noop */ }
			resolve(124);
		}, 5_000)),
	]);
	const stderr = await stderrPromise;
	return { ok: code === 0, code, stderr };
}

describe.skipIf(!HAS_FFMPEG)("encoder probe (real ffmpeg)", () => {
	test("libx264 passes the open-session probe", async () => {
		const r = await probe("libx264", ["-preset", "ultrafast"]);
		if (!r.ok) console.error("libx264 probe stderr:", r.stderr.slice(0, 500));
		expect(r.ok).toBe(true);
	}, 10_000);

	test("invalid encoder name fails the probe (within ~500ms)", async () => {
		const t0 = Date.now();
		const r = await probe("h264_definitely_does_not_exist_xyz", []);
		const elapsed = Date.now() - t0;
		expect(r.ok).toBe(false);
		// Should fail fast, not hang.
		expect(elapsed).toBeLessThan(2_000);
	}, 10_000);

	test("invalid option for a real encoder fails the probe", async () => {
		// libx264 doesn't take `-bogus_option`; ffmpeg should reject.
		const r = await probe("libx264", ["-bogus_option_xyz", "value"]);
		expect(r.ok).toBe(false);
	}, 10_000);
});
