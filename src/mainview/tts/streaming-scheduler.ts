// Plays a stream of PCM16 chunks gaplessly.
//
// Each `appendPCM16(int16)` call converts samples to Float32 ([-1, 1]),
// wraps them in an AudioBuffer, and schedules a BufferSourceNode at the
// playhead — which advances by the buffer's duration. The first chunk
// starts ASAP (`max(now, prev-end)`); subsequent chunks queue contiguously
// so there's no audible gap as long as encoding keeps up.
//
// `stop()` cancels everything scheduled and resets the playhead. Use it
// between utterances so the user can interrupt mid-sentence.

export class StreamingAudioScheduler {
	private nextStartTime: number;
	private sources = new Set<AudioBufferSourceNode>();

	constructor(
		private ctx: AudioContext,
		private destination: AudioNode,
		private sampleRate: number,
	) {
		this.nextStartTime = ctx.currentTime;
	}

	appendPCM16(int16: Int16Array): void {
		if (int16.length === 0) return;
		const float32 = new Float32Array(int16.length);
		for (let i = 0; i < int16.length; i++) float32[i] = (int16[i] ?? 0) / 32768;
		const buffer = this.ctx.createBuffer(1, float32.length, this.sampleRate);
		buffer.copyToChannel(float32, 0);

		const source = this.ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(this.destination);
		const start = Math.max(this.nextStartTime, this.ctx.currentTime + 0.02);
		source.start(start);
		this.nextStartTime = start + buffer.duration;

		this.sources.add(source);
		source.onended = (): void => {
			this.sources.delete(source);
		};
	}

	stop(): void {
		for (const source of this.sources) {
			try {
				source.stop();
			} catch {
				// already stopped — ignore
			}
		}
		this.sources.clear();
		this.nextStartTime = this.ctx.currentTime;
	}
}
