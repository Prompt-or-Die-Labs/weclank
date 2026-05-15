import { beforeEach, describe, expect, test } from "bun:test";
import { anyHumanSpeaking } from "./vad";
import { audioMixer } from "../streaming/audio-mixer";
import { studio } from "../state/studio-store";
import { participantId } from "../core/ids";

const HOST_ID = participantId("host");

function attachAnalyserWithAmplitude(pid: ReturnType<typeof participantId>, amplitude: number): void {
	audioMixer.addInput(pid, new MediaStream());
	const analyser = audioMixer.getAnalyser(pid);
	if (!analyser) throw new Error("Analyser should be attached");
	// Override the stub's getByteFrequencyData to fill the array with our
	// chosen amplitude (0-255). VAD averages these, divides by 255, and
	// compares to threshold 0.05.
	analyser.getByteFrequencyData = (arr: Uint8Array): void => {
		arr.fill(amplitude);
	};
}

beforeEach(() => {
	studio.installRestored({});
	// Remove any analysers from a previous test.
	for (const id of Object.keys(studio.state.participants)) {
		audioMixer.removeInput(id);
	}
});

describe("anyHumanSpeaking", () => {
	test("returns false when no participants have analysers attached", () => {
		expect(anyHumanSpeaking()).toBe(false);
	});

	test("returns true when a non-agent participant is above the amplitude threshold", () => {
		// amplitude/255 = 200/255 ≈ 0.78, well above the 0.05 threshold.
		attachAnalyserWithAmplitude(HOST_ID, 200);
		expect(anyHumanSpeaking()).toBe(true);
	});

	test("returns false when the only participant is quiet", () => {
		// amplitude/255 = 5/255 ≈ 0.02, below the 0.05 threshold.
		attachAnalyserWithAmplitude(HOST_ID, 5);
		expect(anyHumanSpeaking()).toBe(false);
	});

	test("ignores agent participants even when they are speaking", () => {
		// Add a voice agent and have it "speak". VAD must NOT pause itself.
		const agentId = participantId("agent-1");
		studio.addParticipant({
			id: agentId,
			displayName: "Agent",
			kind: "voice",
			muted: false,
			cameraOff: false,
			isAgent: true,
		});
		attachAnalyserWithAmplitude(agentId, 200);
		expect(anyHumanSpeaking()).toBe(false);
	});

	test("returns true when any one of multiple humans is speaking", () => {
		const second = participantId("co-host");
		studio.addParticipant({
			id: second,
			displayName: "Co-host",
			kind: "camera",
			muted: false,
			cameraOff: true,
			isAgent: false,
		});
		// Host quiet, co-host speaking.
		attachAnalyserWithAmplitude(HOST_ID, 5);
		attachAnalyserWithAmplitude(second, 200);
		expect(anyHumanSpeaking()).toBe(true);
	});

	test("ignores participants without an attached analyser", () => {
		// HOST_ID is present in studio state but has no mixer channel attached.
		expect(anyHumanSpeaking()).toBe(false);
	});
});
