import { describe, expect, test } from "bun:test";
import { FfmpegStderrClassifier, classifyFfmpegLine } from "./ffmpeg-errors";

describe("classifyFfmpegLine — IGNORED patterns", () => {
	test("empty lines are ignored", () => {
		expect(classifyFfmpegLine("").ignore).toBe(true);
		expect(classifyFfmpegLine("   \t  ").ignore).toBe(true);
	});

	test("deprecated pixel format warning is ignored", () => {
		const r = classifyFfmpegLine("[swscaler @ 0x7f] deprecated pixel format used, make sure you did set range correctly");
		expect(r.ignore).toBe(true);
	});

	test("Non-monotonous DTS noise is ignored", () => {
		const r = classifyFfmpegLine("[flv @ 0x600] Non-monotonous DTS in output stream 0:1");
		expect(r.ignore).toBe(true);
	});

	test("Past duration warning is ignored", () => {
		const r = classifyFfmpegLine("Past duration 0.999992 too large");
		expect(r.ignore).toBe(true);
	});
});

describe("classifyFfmpegLine — error map", () => {
	test("unknown NVENC encoder gives a friendly NVENC message", () => {
		const r = classifyFfmpegLine("[error] Unknown encoder 'h264_nvenc'");
		expect(r.userMessage).toMatch(/NVENC/);
		expect(r.userMessage).toMatch(/libx264/);
		expect(r.severity).toBe("fatal");
	});

	test("unknown VideoToolbox encoder suggests Homebrew install", () => {
		const r = classifyFfmpegLine("Unknown encoder 'h264_videotoolbox'");
		expect(r.userMessage).toMatch(/VideoToolbox/);
		expect(r.userMessage).toMatch(/Homebrew/);
		expect(r.severity).toBe("fatal");
	});

	test("VAAPI render device permission error suggests usermod", () => {
		const r = classifyFfmpegLine(
			"[h264_vaapi @ 0x..] Failed to set value '/dev/dri/renderD128' for option 'vaapi_device'",
		);
		expect(r.userMessage).toMatch(/render/);
		expect(r.userMessage).toMatch(/usermod/);
		expect(r.severity).toBe("fatal");
	});

	test("Connection refused → fatal RTMP server unreachable", () => {
		const r = classifyFfmpegLine("[tcp @ 0x..] Connection refused");
		expect(r.userMessage).toMatch(/refused/i);
		expect(r.severity).toBe("fatal");
	});

	test("Connection reset → transient (reconnect will retry)", () => {
		const r = classifyFfmpegLine("[rtmp @ 0x..] Connection reset by peer");
		expect(r.userMessage).toMatch(/dropped/i);
		expect(r.severity).toBe("transient");
	});

	test("401 → invalid stream key", () => {
		const r = classifyFfmpegLine("Server returned 401 Unauthorized (authorization failed)");
		expect(r.userMessage).toMatch(/credentials/i);
		expect(r.severity).toBe("fatal");
	});

	test("OOM on NVENC session → concurrent-stream limit", () => {
		const r = classifyFfmpegLine("OpenEncodeSessionEx failed: out of memory (10): (no details)");
		expect(r.userMessage).toMatch(/concurrent/);
		expect(r.userMessage).toMatch(/libx264/);
	});

	test("'Unrecognized option' generic catchall is last in its bucket", () => {
		// A non-vaapi-specific Unrecognized option should hit the
		// generic message, not the vaapi-specific one.
		const r = classifyFfmpegLine("Unrecognized option 'experimental'");
		expect(r.userMessage).toMatch(/encoder options/i);
		expect(r.userMessage).toMatch(/upgrade/i);
	});

	test("vaapi-specific Unrecognized option message wins over generic", () => {
		const r = classifyFfmpegLine("Unrecognized option 'vaapi_device'");
		expect(r.userMessage).toMatch(/VAAPI/);
		expect(r.userMessage).toMatch(/libx264/);
	});

	test("unknown line returns empty result (no ignore, no message)", () => {
		const r = classifyFfmpegLine("frame=  240 fps= 30 bitrate=2048.0kbits/s");
		expect(r.ignore).toBeUndefined();
		expect(r.userMessage).toBeUndefined();
	});
});

describe("FfmpegStderrClassifier — dedup", () => {
	test("identical user messages are suppressed on second occurrence", () => {
		const c = new FfmpegStderrClassifier();
		const line = "[tcp] Connection refused";
		const first = c.classify(line);
		expect(first.userMessage).toBeDefined();
		const second = c.classify(line);
		expect(second.ignore).toBe(true);
	});

	test("different messages don't suppress each other", () => {
		const c = new FfmpegStderrClassifier();
		const a = c.classify("[tcp] Connection refused");
		const b = c.classify("Unknown encoder 'h264_nvenc'");
		expect(a.userMessage).toBeDefined();
		expect(b.userMessage).toBeDefined();
		expect(a.userMessage).not.toBe(b.userMessage);
	});

	test("reset() clears the dedup state", () => {
		const c = new FfmpegStderrClassifier();
		c.classify("[tcp] Connection refused");
		c.reset();
		const r = c.classify("[tcp] Connection refused");
		expect(r.userMessage).toBeDefined();
		expect(r.ignore).toBeUndefined();
	});
});
