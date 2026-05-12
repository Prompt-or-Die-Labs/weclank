// Float32 mono PCM → 16-bit linear-PCM WAV ArrayBuffer. Plain RIFF header
// + interleaved samples. Used to package mic captures for OpenRouter's
// audio-input content type, which accepts WAV directly.

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);

	// RIFF chunk descriptor
	writeAscii(view, 0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	writeAscii(view, 8, "WAVE");

	// "fmt " sub-chunk
	writeAscii(view, 12, "fmt ");
	view.setUint32(16, 16, true); // PCM fmt chunk size
	view.setUint16(20, 1, true); // audio format: 1 = linear PCM
	view.setUint16(22, 1, true); // channels: mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * channels * bytesPerSample)
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample

	// "data" sub-chunk
	writeAscii(view, 36, "data");
	view.setUint32(40, samples.length * 2, true);

	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
		view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	}
	return buffer;
}

function writeAscii(view: DataView, offset: number, s: string): void {
	for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
