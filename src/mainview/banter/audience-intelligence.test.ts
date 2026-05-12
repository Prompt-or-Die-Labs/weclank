import { beforeEach, describe, expect, test } from "bun:test";
import { audienceIntelligence } from "./audience-intelligence";

describe("audience intelligence", () => {
	beforeEach(() => {
		audienceIntelligence.clear();
	});

	test("extracts viewer questions and chat velocity", () => {
		const now = Date.now();
		audienceIntelligence.recordMessage({ author: "Mina", text: "What plugin is that?", timestamp: now - 10_000 });
		const snapshot = audienceIntelligence.recordMessage({ author: "Rue", text: "can you explain the overlay?", timestamp: now });

		expect(snapshot.chatVelocity).toBe(2);
		expect(snapshot.questions).toHaveLength(2);
		expect(snapshot.questions[0]?.author).toBe("Rue");
	});

	test("tracks dominant sentiment across recent chat", () => {
		const now = Date.now();
		audienceIntelligence.recordMessage({ author: "Ari", text: "this is awesome", timestamp: now - 2_000 });
		audienceIntelligence.recordMessage({ author: "Bo", text: "great idea", timestamp: now - 1_000 });
		const snapshot = audienceIntelligence.recordMessage({ author: "Cy", text: "I am watching", timestamp: now });

		expect(snapshot.sentiment.positive).toBe(2);
		expect(snapshot.sentiment.neutral).toBe(1);
		expect(snapshot.sentiment.label).toBe("positive");
	});

	test("flags links, duplicate spam, caps, and harassment terms", () => {
		const now = Date.now();
		audienceIntelligence.recordMessage({ author: "Linker", text: "visit https://example.com now", timestamp: now });
		audienceIntelligence.recordMessage({ author: "Caps", text: "THIS IS WAY TOO LOUD", timestamp: now + 1 });
		audienceIntelligence.recordMessage({ author: "Spammer", text: "buy my course", timestamp: now + 2 });
		audienceIntelligence.recordMessage({ author: "Spammer", text: "buy my course", timestamp: now + 3 });
		audienceIntelligence.recordMessage({ author: "Spammer", text: "buy my course", timestamp: now + 4 });
		const snapshot = audienceIntelligence.recordMessage({ author: "Rude", text: "shut up already", timestamp: now + 5 });

		expect(snapshot.flags.map((flag) => flag.kind)).toContain("link");
		expect(snapshot.flags.map((flag) => flag.kind)).toContain("caps");
		expect(snapshot.flags.map((flag) => flag.kind)).toContain("spam");
		expect(snapshot.flags.map((flag) => flag.kind)).toContain("toxicity");
	});
});
