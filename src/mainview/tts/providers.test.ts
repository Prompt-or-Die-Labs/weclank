// Direct provider-construction smoke tests.
//
// Why not test the registry module here: earlier test files (notably
// `state/source-factory.test.ts` and `state/participant-runtime.test.ts`)
// install a `mock.module("./registry", …)` stub that persists for the
// rest of the process — bun's mock.module has no restore for module
// stubs. Testing the registry's switch / Map directly would always hit
// the mocked module, not the real implementation.
//
// The lifecycle of voice routes (disposal order, etc.) is already
// exercised by `state/participant-runtime.test.ts`. What's left to verify
// is that each TTS provider class constructs with a reasonable config
// without throwing — the registry's `build()` switch is a thin wrapper
// over these constructors.

import { describe, expect, test } from "bun:test";
import { ElevenLabsTTSProvider } from "./elevenlabs-tts";
import { OpenRouterTTSProvider } from "./openrouter-tts";
import { OpenAiSpeechTTSProvider } from "./openai-speech-tts";
import { ElizaCloudTTSProvider } from "./elizacloud-tts";
import { OmniVoiceTTSProvider } from "./omnivoice-tts";
import { ConfigError } from "../core/errors";

describe("TTS provider construction (smoke)", () => {
	test("ElevenLabs constructs with an API key + voice + model", () => {
		const provider = new ElevenLabsTTSProvider("test-key", "test-voice", "eleven_turbo_v2_5");
		expect(provider.id).toBe("elevenlabs");
		expect(provider.getStream()).toBeTruthy();
		provider.dispose();
	});

	test("OpenRouter requires an API key", () => {
		expect(() => new OpenRouterTTSProvider({ apiKey: "", voice: "alloy", model: "openai/gpt-4o-audio-preview" })).toThrow(ConfigError);
		const provider = new OpenRouterTTSProvider({ apiKey: "test-key", voice: "alloy", model: "openai/gpt-4o-audio-preview" });
		expect(provider.id).toBe("openrouter");
		provider.dispose();
	});

	test("OpenAI requires an API key", () => {
		expect(() => new OpenAiSpeechTTSProvider({ apiKey: "", voice: "alloy", model: "gpt-4o-mini-tts" })).toThrow(ConfigError);
		const provider = new OpenAiSpeechTTSProvider({ apiKey: "test-key", voice: "alloy", model: "gpt-4o-mini-tts" });
		expect(provider.id).toBe("openai");
		provider.dispose();
	});

	test("ElizaCloud requires an API key", () => {
		expect(() => new ElizaCloudTTSProvider({ apiKey: "", voice: "alloy", model: "elizacloud-tts-default" })).toThrow(ConfigError);
		const provider = new ElizaCloudTTSProvider({ apiKey: "test-key", voice: "alloy", model: "elizacloud-tts-default" });
		expect(provider.id).toBe("elizacloud");
		provider.dispose();
	});

	test("OmniVoice constructs without an API key (uses local sidecar)", () => {
		const provider = new OmniVoiceTTSProvider({ voice: "default" });
		expect(provider.id).toBe("omnivoice");
		provider.dispose();
	});

	test("Disposing a provider is idempotent (safe to call twice)", () => {
		const provider = new ElevenLabsTTSProvider("test-key");
		provider.dispose();
		expect(() => provider.dispose()).not.toThrow();
	});
});
