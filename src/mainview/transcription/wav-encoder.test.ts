import { describe, expect, test } from "bun:test";
import { encodeWav } from "./wav-encoder";

describe("encodeWav", () => {
	test("produces a RIFF/WAVE header at the documented offsets", () => {
		const samples = new Float32Array(8);
		const wav = encodeWav(samples, 48_000);
		const view = new DataView(wav);
		const ascii = (off: number, len: number): string =>
			new TextDecoder().decode(new Uint8Array(wav, off, len));

		expect(ascii(0, 4)).toBe("RIFF");
		expect(ascii(8, 4)).toBe("WAVE");
		expect(ascii(12, 4)).toBe("fmt ");
		expect(ascii(36, 4)).toBe("data");
		// fmt chunk: PCM (1), mono (1), 48k sampleRate, 16-bit
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(48_000);
		expect(view.getUint16(34, true)).toBe(16);
	});

	test("clamps samples outside [-1, 1] to int16 bounds", () => {
		const samples = new Float32Array([0, 1, -1, 2, -2, 0.5, -0.5]);
		const wav = encodeWav(samples, 24_000);
		const view = new DataView(wav);
		// First sample = 0
		expect(view.getInt16(44, true)).toBe(0);
		// 1.0 clamps to +0x7fff
		expect(view.getInt16(46, true)).toBe(0x7fff);
		// -1.0 clamps to -0x8000
		expect(view.getInt16(48, true)).toBe(-0x8000);
		// 2.0 also clamps to +0x7fff
		expect(view.getInt16(50, true)).toBe(0x7fff);
		// -2.0 also clamps to -0x8000
		expect(view.getInt16(52, true)).toBe(-0x8000);
		// 0.5 → 0.5 * 0x7fff ≈ 16383
		expect(view.getInt16(54, true)).toBeCloseTo(0x4000 - 1, 0);
	});

	test("byte length is 44 + samples * 2", () => {
		const n = 1024;
		const wav = encodeWav(new Float32Array(n), 16_000);
		expect(wav.byteLength).toBe(44 + n * 2);
		// RIFF chunk size: 36 + data length (file size minus first 8 bytes)
		const view = new DataView(wav);
		expect(view.getUint32(4, true)).toBe(36 + n * 2);
		expect(view.getUint32(40, true)).toBe(n * 2);
	});
});
