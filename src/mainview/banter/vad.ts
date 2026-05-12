// Voice activity detector. The banter engine asks `anyHumanSpeaking()` on
// each chat tick — when you're talking, the agent stays out of the way.
//
// The check polls all non-agent participants' mixer analysers. Average
// frequency-bin amplitude above the threshold = active. No persistent state
// because the engine only needs an instantaneous read.

import { audioMixer } from "../streaming/audio-mixer";
import { studio } from "../state/studio-store";

const THRESHOLD = 0.05;
const SCRATCH = new Uint8Array(new ArrayBuffer(2048));

export function anyHumanSpeaking(): boolean {
	const participants = studio.state.participants;
	for (const p of Object.values(participants)) {
		if (p.isAgent) continue;
		const analyser = audioMixer.getAnalyser(p.id);
		if (!analyser) continue;
		const bins = Math.min(SCRATCH.length, analyser.frequencyBinCount);
		analyser.getByteFrequencyData(SCRATCH);
		let sum = 0;
		for (let i = 0; i < bins; i++) sum += SCRATCH[i] ?? 0;
		const avg = sum / bins / 255;
		if (avg > THRESHOLD) return true;
	}
	return false;
}
