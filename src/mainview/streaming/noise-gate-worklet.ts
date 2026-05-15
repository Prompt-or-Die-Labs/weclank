// Noise gate via AudioWorkletNode. State machine:
//
//   CLOSED → (level > openThreshold) → OPENING (attack ramp 0→1)
//   OPENING → (attack window complete) → OPEN
//   OPEN → (level < closeThreshold) → HOLDING (waiting holdMs)
//   HOLDING → (level rises above openThreshold again) → OPEN (reset hold)
//   HOLDING → (hold expires) → CLOSING (release ramp 1→0)
//   CLOSING → (release window complete) → CLOSED
//
// Hysteresis between open/close thresholds is the documented OBS
// behavior (`obs-filters/noise-gate-filter.c`): a higher bar to open
// than to close prevents flapping around the noise floor. Defaults
// taken verbatim from OBS:
//   - open: -26 dBFS
//   - close: -32 dBFS
//   - attack: 25 ms
//   - hold: 200 ms
//   - release: 150 ms
//
// The processor source is a string. It gets wrapped in a Blob URL and
// registered as a worklet module — same pattern as mic-transcriber,
// avoiding a separate file in the bundler's copy map.

export interface NoiseGateOptions {
	openThresholdDb?: number;
	closeThresholdDb?: number;
	attackMs?: number;
	holdMs?: number;
	releaseMs?: number;
}

const PROCESSOR_NAME = "weclank-noise-gate";

// Processor source — runs in the audio thread. Designed to be portable
// (no closure references to outside variables). All parameters come in
// via AudioParam or the `parameters` block.
const PROCESSOR_SOURCE = `
class NoiseGateProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{ name: "openThreshold", defaultValue: 0.0501, minValue: 0, maxValue: 1, automationRate: "k-rate" },   // -26 dBFS linear
			{ name: "closeThreshold", defaultValue: 0.0251, minValue: 0, maxValue: 1, automationRate: "k-rate" }, // -32 dBFS linear
			{ name: "attackMs", defaultValue: 25, minValue: 0, maxValue: 5000, automationRate: "k-rate" },
			{ name: "holdMs", defaultValue: 200, minValue: 0, maxValue: 5000, automationRate: "k-rate" },
			{ name: "releaseMs", defaultValue: 150, minValue: 0, maxValue: 5000, automationRate: "k-rate" },
		];
	}

	constructor() {
		super();
		// 0 = CLOSED, 1 = OPENING, 2 = OPEN, 3 = HOLDING, 4 = CLOSING
		this.state = 0;
		this.envelope = 0;   // 0..1 gain ramp position
		this.holdSamplesLeft = 0;
		this.attackSamplesLeft = 0;
		this.releaseSamplesLeft = 0;
	}

	process(inputs, outputs, parameters) {
		const input = inputs[0];
		const output = outputs[0];
		if (!input || input.length === 0) return true;

		const openThr = parameters.openThreshold[0];
		const closeThr = parameters.closeThreshold[0];
		const attackSamples = Math.max(1, Math.round((parameters.attackMs[0] / 1000) * sampleRate));
		const holdSamples = Math.max(0, Math.round((parameters.holdMs[0] / 1000) * sampleRate));
		const releaseSamples = Math.max(1, Math.round((parameters.releaseMs[0] / 1000) * sampleRate));

		// Operate on the first channel; replicate to all output channels.
		const ch0 = input[0];
		const frames = ch0.length;
		const outCh0 = output[0];

		for (let i = 0; i < frames; i++) {
			const x = ch0[i];
			const level = Math.abs(x);

			switch (this.state) {
				case 0: // CLOSED
					if (level > openThr) {
						this.state = 1;
						this.attackSamplesLeft = attackSamples;
					}
					break;
				case 1: // OPENING — attack ramp
					if (this.attackSamplesLeft > 0) {
						this.envelope = 1 - (this.attackSamplesLeft / attackSamples);
						this.attackSamplesLeft--;
					} else {
						this.envelope = 1;
						this.state = 2;
					}
					break;
				case 2: // OPEN
					this.envelope = 1;
					if (level < closeThr) {
						this.state = 3;
						this.holdSamplesLeft = holdSamples;
					}
					break;
				case 3: // HOLDING
					this.envelope = 1;
					if (level > openThr) {
						this.state = 2; // back to OPEN
					} else if (this.holdSamplesLeft > 0) {
						this.holdSamplesLeft--;
					} else {
						this.state = 4;
						this.releaseSamplesLeft = releaseSamples;
					}
					break;
				case 4: // CLOSING — release ramp
					if (this.releaseSamplesLeft > 0) {
						this.envelope = this.releaseSamplesLeft / releaseSamples;
						this.releaseSamplesLeft--;
					} else {
						this.envelope = 0;
						this.state = 0;
					}
					break;
			}

			const gated = x * this.envelope;
			outCh0[i] = gated;
			// Mirror to additional output channels.
			for (let c = 1; c < output.length; c++) {
				output[c][i] = gated;
			}
		}
		return true;
	}
}

registerProcessor("${PROCESSOR_NAME}", NoiseGateProcessor);
`;

let workletReadyPromise: Promise<void> | null = null;

/** Idempotent worklet registration. The Blob URL is created once per
 *  page session; subsequent ensure() calls reuse the same module. */
function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
	if (workletReadyPromise) return workletReadyPromise;
	const blob = new Blob([PROCESSOR_SOURCE], { type: "application/javascript" });
	const url = URL.createObjectURL(blob);
	workletReadyPromise = ctx.audioWorklet.addModule(url).then(() => {
		// Url is no longer needed once the module is loaded.
		URL.revokeObjectURL(url);
	}).catch((err) => {
		// Reset so a future caller can retry. addModule sometimes fails
		// on first call but succeeds on retry (race with worklet thread
		// bootstrap on cold Bun).
		workletReadyPromise = null;
		throw err;
	});
	return workletReadyPromise;
}

export interface NoiseGateNode {
	node: AudioWorkletNode;
	dispose(): void;
}

/** Create the worklet node. Caller must `await ensureWorkletRegistered`
 *  before calling this — wrapped here for ergonomics. */
export async function createNoiseGateNode(
	ctx: BaseAudioContext,
	opts: NoiseGateOptions = {},
): Promise<NoiseGateNode> {
	await ensureWorkletRegistered(ctx);
	const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		channelCount: 2,
		channelCountMode: "explicit",
		channelInterpretation: "speakers",
	});
	// AudioParam writes — convert dBFS to linear amplitude.
	const dbToLinear = (db: number): number => 10 ** (db / 20);
	const set = (name: string, value: number): void => {
		const p = node.parameters.get(name);
		if (p) p.value = value;
	};
	if (opts.openThresholdDb !== undefined) set("openThreshold", dbToLinear(opts.openThresholdDb));
	if (opts.closeThresholdDb !== undefined) set("closeThreshold", dbToLinear(opts.closeThresholdDb));
	if (opts.attackMs !== undefined) set("attackMs", opts.attackMs);
	if (opts.holdMs !== undefined) set("holdMs", opts.holdMs);
	if (opts.releaseMs !== undefined) set("releaseMs", opts.releaseMs);

	return {
		node,
		dispose: (): void => {
			try { node.disconnect(); } catch { /* may already be disconnected */ }
			try { node.port.close(); } catch { /* may not have a port */ }
		},
	};
}
