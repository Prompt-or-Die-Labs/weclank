import { audioMixer } from "../streaming/audio-mixer";
import { studio } from "../state/studio-store";
import { ConfigError } from "../core/errors";
import type { ParticipantId } from "../core/ids";
import type { TTSConfig } from "../core/types";
import type { TTSProvider } from "./provider";
import { createTTSProvider, disposeTTSProvider, getTTSProvider } from "./registry";

export interface VoiceRoute {
	provider: TTSProvider;
	stream: MediaStream;
}

export function initVoiceRoute(
	participantId: ParticipantId,
	config: TTSConfig,
	opts: { updateParticipant?: boolean } = {},
): VoiceRoute {
	audioMixer.removeInput(participantId);
	const provider = createTTSProvider(participantId, config);
	const stream = provider.getStream();
	audioMixer.addInput(participantId, stream);
	if (opts.updateParticipant !== false) {
		studio.updateParticipant(participantId, { tts: config, audioStream: stream });
	}
	return { provider, stream };
}

export function ensureVoiceRoute(participantId: ParticipantId): TTSProvider | null {
	const existing = getTTSProvider(participantId);
	if (existing) return existing;
	const participant = studio.state.participants[participantId];
	if (!participant?.tts) return null;
	return initVoiceRoute(participantId, participant.tts).provider;
}

export async function speakWithVoiceRoute(participantId: ParticipantId, text: string): Promise<void> {
	const provider = ensureVoiceRoute(participantId);
	if (!provider) {
		throw new ConfigError("No TTS provider configured", "Configure voice settings first.");
	}
	await provider.speak(text);
}

export function disposeVoiceRoute(participantId: ParticipantId): void {
	disposeTTSProvider(participantId);
	audioMixer.removeInput(participantId);
}
