// Audio-driven lip sync. Reads amplitude from the participant's AnalyserNode
// and produces a 0..1 "openness" value the VRM/GLB renderer applies to the
// mouth blend-shape or a mouth bone scale.
//
// This is intentionally crude: real lip-sync needs viseme classification
// (e.g. Rhubarb, Oculus LipSync). Treat this as a hook point — swap in a
// proper analyser later.

export class LipSync {
	private data: Uint8Array<ArrayBuffer>;
	private smoothed = 0;

	constructor(private analyser: AnalyserNode) {
		this.data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
	}

	/** Returns mouth openness in [0,1]. Call once per frame. */
	read(): number {
		this.analyser.getByteFrequencyData(this.data);
		// Focus on the speech band (~85Hz–3kHz). At 48kHz sample rate and
		// fftSize=2048 each bin is ~23Hz; speech sits roughly in bins 4..130.
		let sum = 0;
		let count = 0;
		const start = 4;
		const end = Math.min(130, this.data.length);
		for (let i = start; i < end; i++) {
			sum += this.data[i] ?? 0;
			count++;
		}
		const raw = count > 0 ? sum / count / 255 : 0;
		// Asymmetric smoothing: open fast, close slow, gives a more natural
		// chatter shape than a single low-pass filter.
		const target = Math.min(1, raw * 1.6);
		const alpha = target > this.smoothed ? 0.55 : 0.18;
		this.smoothed = this.smoothed + (target - this.smoothed) * alpha;
		return this.smoothed;
	}
}
