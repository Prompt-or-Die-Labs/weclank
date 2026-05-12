// MicTranscriber — singleton that captures the host's mic, batches
// utterances on silence, transcribes via OpenRouter, and pushes text to
// subscribers (banter sessions).
//
// Capture path uses AudioWorkletNode. The worklet processor source lives
// inline as a string here, gets wrapped in a Blob, and is registered with
// the AudioContext via the module's URL — this avoids needing a separate
// JS file in the bundler's copy map. The worklet runs in the audio thread
// (so silent dropouts don't happen if the main thread is busy) and emits
// Float32 mono chunks back over its message port.
//
// VAD strategy: RMS over each chunk (~5–10ms at 48kHz with the default
// worklet quantum size of 128 samples — we accumulate larger windows).
// Once a chunk crosses SPEAKING_THRESHOLD we mark "accumulating"; after
// SILENCE_FRAMES_TO_FLUSH consecutive sub-threshold chunks we flush.
//
// Cost guardrails:
//   - MAX_UTTERANCES_PER_MIN — hard cap so a hot mic / open channel
//     doesn't burn the budget while you're afk.
//   - Cumulative cost from the STT endpoint's usage.cost field is exposed
//     via getStats(); the perf HUD surfaces it.

import { audioMixer } from "../streaming/audio-mixer";
import { studio } from "../state/studio-store";
import { encodeWav } from "./wav-encoder";
import { transcribeWav, DEFAULT_TRANSCRIBE_MODEL } from "./openrouter-stt";
import { transcribeWavOpenAI, DEFAULT_OPENAI_TRANSCRIBE_MODEL } from "./openai-stt";

// Worklet quantum is 128 samples → ~2.7ms at 48kHz. We collect a window
// of these inside the worklet so VAD/RMS work on a useful chunk size
// rather than 2.7ms slivers. 4096 samples ≈ 85ms.
const WORKLET_WINDOW_SAMPLES = 4096;
const SPEAKING_THRESHOLD = 0.012;
const SILENCE_FRAMES_TO_FLUSH = 7; // ~600ms
const MIN_UTTERANCE_SAMPLES = 8_000;
const MAX_UTTERANCE_SAMPLES = 48_000 * 30; // 30s hard cap
const MAX_UTTERANCES_PER_MIN = 14;
const CHECK_FOR_SOURCE_MS = 4_000;

// Worklet processor source. Buffers WORKLET_WINDOW_SAMPLES worth of mono
// PCM, then posts a Float32Array to the main thread.
const WORKLET_SOURCE = `
class MicCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._buffer = new Float32Array(${WORKLET_WINDOW_SAMPLES});
		this._offset = 0;
	}
	process(inputs) {
		const input = inputs[0];
		const ch = input && input[0];
		if (!ch || ch.length === 0) return true;
		let i = 0;
		while (i < ch.length) {
			const need = this._buffer.length - this._offset;
			const take = Math.min(need, ch.length - i);
			this._buffer.set(ch.subarray(i, i + take), this._offset);
			this._offset += take;
			i += take;
			if (this._offset >= this._buffer.length) {
				this.port.postMessage(this._buffer.slice());
				this._offset = 0;
			}
		}
		return true;
	}
}
registerProcessor("mic-capture", MicCaptureProcessor);
`;

type Listener = (text: string) => void;

class MicTranscriber {
	private active = false;
	private workletReady: Promise<void> | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private node: AudioWorkletNode | null = null;
	private subscribers = new Set<Listener>();
	private rediscoverTimer: ReturnType<typeof setInterval> | null = null;

	private buffer: Float32Array[] = [];
	private bufferLength = 0;
	private accumulating = false;
	private silenceFrames = 0;

	private model = DEFAULT_TRANSCRIBE_MODEL;
	private transcriptionProvider: "openrouter" | "openai" = "openrouter";
	private cumulativeCost = 0;
	private utterancesThisMinute = 0;
	private rateLimitWindowStart = Date.now();

	subscribe(fn: Listener): () => void {
		this.subscribers.add(fn);
		this.ensureRunning();
		return () => {
			this.subscribers.delete(fn);
			if (this.subscribers.size === 0) this.tearDown();
		};
	}

	setModel(model: string): void {
		this.model = model || (this.transcriptionProvider === "openai" ? DEFAULT_OPENAI_TRANSCRIBE_MODEL : DEFAULT_TRANSCRIBE_MODEL);
	}

	setTranscription(opts: { provider?: "openrouter" | "openai"; model?: string }): void {
		if (opts.provider) this.transcriptionProvider = opts.provider;
		if (opts.model?.trim()) {
			this.model = opts.model.trim();
			return;
		}
		this.model =
			this.transcriptionProvider === "openai" ? DEFAULT_OPENAI_TRANSCRIBE_MODEL : DEFAULT_TRANSCRIBE_MODEL;
	}

	get isRunning(): boolean {
		return this.active;
	}

	getStats(): { model: string; utterancesPerMin: number; cumulativeCostUsd: number } {
		// Approximate per-min rate as the count in the current rolling window.
		const elapsedMin = Math.max(0.001, (Date.now() - this.rateLimitWindowStart) / 60_000);
		return {
			model: this.model,
			utterancesPerMin: this.utterancesThisMinute / Math.min(1, elapsedMin) || 0,
			cumulativeCostUsd: this.cumulativeCost,
		};
	}

	private ensureRunning(): void {
		if (this.rediscoverTimer) return;
		void this.tryAttach();
		this.rediscoverTimer = setInterval(() => void this.tryAttach(), CHECK_FOR_SOURCE_MS);
	}

	private async tryAttach(): Promise<void> {
		if (this.active) return;
		const stream = findHostAudioStream();
		if (!stream) return;
		await this.attachTo(stream);
	}

	private async attachTo(stream: MediaStream): Promise<void> {
		const ctx = audioMixer.ctx;
		try {
			await this.ensureWorklet(ctx);
			this.source = ctx.createMediaStreamSource(stream);
			// numberOfOutputs: 0 — we only consume, never produce. Avoids
			// having to connect to a sink to keep the processor running.
			this.node = new AudioWorkletNode(ctx, "mic-capture", {
				numberOfInputs: 1,
				numberOfOutputs: 0,
			});
			this.node.port.onmessage = (e: MessageEvent<Float32Array>): void => this.process(e.data);
			this.source.connect(this.node);
			this.active = true;
			console.log("[transcribe] mic capture started via AudioWorklet");
		} catch (err) {
			console.warn("[transcribe] attach failed", err);
			this.tearDownNodes();
		}
	}

	private ensureWorklet(ctx: AudioContext): Promise<void> {
		if (this.workletReady) return this.workletReady;
		const blob = new Blob([WORKLET_SOURCE], { type: "text/javascript" });
		const url = URL.createObjectURL(blob);
		this.workletReady = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
		return this.workletReady;
	}

	private tearDown(): void {
		if (this.rediscoverTimer) clearInterval(this.rediscoverTimer);
		this.rediscoverTimer = null;
		this.tearDownNodes();
	}

	private tearDownNodes(): void {
		try { this.source?.disconnect(); } catch { /* noop */ }
		try { this.node?.disconnect(); } catch { /* noop */ }
		if (this.node) this.node.port.onmessage = null;
		this.source = null;
		this.node = null;
		this.buffer = [];
		this.bufferLength = 0;
		this.accumulating = false;
		this.silenceFrames = 0;
		this.active = false;
	}

	private process(chunk: Float32Array): void {
		let sum = 0;
		for (let i = 0; i < chunk.length; i++) {
			const s = chunk[i] ?? 0;
			sum += s * s;
		}
		const rms = Math.sqrt(sum / chunk.length);
		const speaking = rms > SPEAKING_THRESHOLD;

		if (speaking || this.accumulating) {
			this.buffer.push(chunk);
			this.bufferLength += chunk.length;
			if (speaking) {
				this.accumulating = true;
				this.silenceFrames = 0;
			} else {
				this.silenceFrames++;
				if (this.silenceFrames >= SILENCE_FRAMES_TO_FLUSH) this.flush();
			}
			if (this.bufferLength >= MAX_UTTERANCE_SAMPLES) this.flush();
		}
	}

	private flush(): void {
		if (this.bufferLength < MIN_UTTERANCE_SAMPLES) {
			this.resetBuffer();
			return;
		}
		const merged = mergeFloat32(this.buffer, this.bufferLength);
		this.resetBuffer();
		void this.dispatch(merged);
	}

	private resetBuffer(): void {
		this.buffer = [];
		this.bufferLength = 0;
		this.accumulating = false;
		this.silenceFrames = 0;
	}

	private async dispatch(samples: Float32Array): Promise<void> {
		// Sliding 60s rate-limit window. Resets cleanly each minute.
		const now = Date.now();
		if (now - this.rateLimitWindowStart > 60_000) {
			this.utterancesThisMinute = 0;
			this.rateLimitWindowStart = now;
		}
		if (this.utterancesThisMinute >= MAX_UTTERANCES_PER_MIN) {
			console.warn("[transcribe] rate-limited — dropping utterance");
			return;
		}
		this.utterancesThisMinute++;

		try {
			const wav = encodeWav(samples, audioMixer.ctx.sampleRate);
			const result =
				this.transcriptionProvider === "openai"
					? await transcribeWavOpenAI(wav, { model: this.model })
					: await transcribeWav(wav, { model: this.model });
			this.cumulativeCost += result.cost;
			if (!result.text || result.text.length < 2) return;
			for (const listener of this.subscribers) {
				try { listener(result.text); } catch (err) { console.warn("[transcribe] listener failed", err); }
			}
		} catch (err) {
			console.warn("[transcribe] failed", err);
		}
	}
}

function findHostAudioStream(): MediaStream | null {
	const state = studio.state;
	for (const p of Object.values(state.participants)) {
		if (p.isAgent) continue;
		if (p.audioStream && p.audioStream.getAudioTracks().some((t) => t.readyState === "live")) {
			return p.audioStream;
		}
	}
	return null;
}

function mergeFloat32(chunks: Float32Array[], total: number): Float32Array {
	const out = new Float32Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export const micTranscriber = new MicTranscriber();
