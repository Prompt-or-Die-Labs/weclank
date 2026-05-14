import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { audienceIntelligence } from "../../banter/audience-intelligence";
import { transcriptFeed } from "../../transcript/feed";
import { OutputsTab } from "./outputs-tab";

beforeEach(() => {
	audienceIntelligence.clear();
	transcriptFeed.__seedForTesting([
		{ seq: 1, ts: 10_000, kind: "assistant_text", summary: "We built the overlay approval flow" },
		{ seq: 2, ts: 20_000, kind: "assistant_tool", summary: "Bash bun test passed" },
	]);
});

afterEach(() => {
	document.body.innerHTML = "";
	audienceIntelligence.clear();
	transcriptFeed.__seedForTesting([]);
});

describe("OutputsTab", () => {
	test("surfaces short-form clip data in the UI", () => {
		const tab = new OutputsTab();
		tab.mount(document.body);

		try {
			expect(document.body.textContent).toContain("Short-form package");
			expect(document.body.querySelectorAll(".tab-outputs__short").length).toBeGreaterThan(0);
			expect(document.body.textContent).toContain("Hook");
			expect(document.body.textContent).toContain("B-roll");
			expect(document.body.textContent).toContain("Timeline-ready clips");
		} finally {
			tab.destroy();
		}
	});
});
