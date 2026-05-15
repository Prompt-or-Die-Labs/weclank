// Per-channel audio filter chain. The mixer inserts these between the
// source and the per-channel gain so the user's gain slider always
// represents the post-filtered level.
//
// Filter order — signal flows through:
//   source → gate (passthrough until worklet ready) → compressor → limiter → gain
//
// - Noise gate (AudioWorklet, OBS thresholds): kills room tone + AC hum
//   during silence. Inserts a passthrough first; the actual gate worklet
//   attaches async once registered.
// - Compressor (DynamicsCompressorNode): catches loud transients (door
//   slams, sudden coughs). Streamer voice rarely triggers so it's
//   strictly an improvement.
// - Limiter (DynamicsCompressorNode at extreme settings): hard ceiling
//   at -6 dBFS so audio never clips.
//
// All thresholds are OBS upstream defaults from
// libobs/audio-filters/{compressor,limiter,noise-gate-filter}.c —
// domain facts (audio engineering, not OBS-specific) and freely reusable.

import type { Labels } from "../observability";
import { createNoiseGateNode } from "./noise-gate-worklet";

export interface FilterChain {
	/** The input node — connect your source to this. */
	input: AudioNode;
	/** The output node — connect this to the channel gain. */
	output: AudioNode;
	/** Tear down the filter graph. The owner-of-the-graph (audio mixer)
	 *  must call this when removing a channel. */
	dispose(): void;
}

export interface FilterChainOptions {
	/** Skip the entire chain — for already-mastered sources like
	 *  TTS providers / pre-rendered music where the audio is
	 *  studio-clean. Default false. */
	bypass?: boolean;
	/** Insert the noise-gate worklet. Default false — many sources
	 *  (camera mics, virtual audio devices) need it; many others
	 *  (mic-as-line-input, voice-changer pipeline) don't. Caller
	 *  decides per-channel. */
	noiseGate?: boolean;
}

/** Build a default compressor.
 *
 *  OBS defaults (libobs/audio-filters/compressor.c):
 *    ratio=10, threshold=-18dB, attack=6ms, release=60ms, output-gain=0.
 *  WebAudio's DynamicsCompressorNode takes seconds for attack/release. */
function makeCompressor(ctx: BaseAudioContext): DynamicsCompressorNode {
	const c = ctx.createDynamicsCompressor();
	c.threshold.value = -18;
	c.knee.value = 6; // smooth-knee 6dB (OBS default)
	c.ratio.value = 10;
	c.attack.value = 0.006;  // 6 ms
	c.release.value = 0.06;  // 60 ms
	return c;
}

/** Hard-knee limiter at -6 dBFS. OBS uses a separate impl but a
 *  DynamicsCompressorNode at ratio=20, knee=0 is the documented
 *  equivalent. */
function makeLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
	const l = ctx.createDynamicsCompressor();
	l.threshold.value = -6;
	l.knee.value = 0;
	l.ratio.value = 20;
	l.attack.value = 0.001;  // near-instant
	l.release.value = 0.06;  // 60 ms — OBS default
	return l;
}

export function createFilterChain(ctx: BaseAudioContext, opts: FilterChainOptions = {}): FilterChain {
	// `bypass` produces a degenerate chain with input === output. The
	// mixer connects source → chain.input → ... → chain.output → gain,
	// so a passthrough is the cleanest way to disable filters without
	// special-casing the graph in the mixer.
	if (opts.bypass) {
		const pass = ctx.createGain(); // gain=1 is a no-op
		return {
			input: pass,
			output: pass,
			dispose: () => pass.disconnect(),
		};
	}

	const compressor = makeCompressor(ctx);
	const limiter = makeLimiter(ctx);

	// Insertion point for the (async) noise-gate worklet. Synchronously
	// we put a passthrough gain at the head; if noiseGate is requested,
	// we kick off the worklet creation in the background and re-wire
	// the graph when it's ready. Until then, the chain is just
	// compressor → limiter.
	const inputPass = ctx.createGain();
	inputPass.connect(compressor);
	compressor.connect(limiter);

	let gateNode: { node: AudioNode; dispose(): void } | null = null;
	let disposed = false;

	if (opts.noiseGate) {
		// Best-effort async insertion. If the worklet fails to register
		// (older Safari? Bun headless? test stubs?) the chain stays
		// passthrough — no audible regression.
		void (async (): Promise<void> => {
			try {
				const gate = await createNoiseGateNode(ctx);
				if (disposed) {
					gate.dispose();
					return;
				}
				// Re-wire: inputPass → gate → compressor (was inputPass → compressor).
				try { inputPass.disconnect(compressor); } catch { /* may have been torn down */ }
				inputPass.connect(gate.node);
				gate.node.connect(compressor);
				gateNode = gate;
			} catch (err) {
				// Worklet unavailable; leave the chain as passthrough.
				console.warn("[audio-filters] noise-gate worklet unavailable, falling back to passthrough", err);
			}
		})();
	}

	return {
		input: inputPass,
		output: limiter,
		dispose: (): void => {
			disposed = true;
			try { inputPass.disconnect(); } catch { /* ignore */ }
			try { gateNode?.dispose(); } catch { /* ignore */ }
			try { compressor.disconnect(); } catch { /* ignore */ }
			try { limiter.disconnect(); } catch { /* ignore */ }
		},
	};
}

// Re-export for the audio-mixer caller — keeps the import surface tight.
export type { Labels };
