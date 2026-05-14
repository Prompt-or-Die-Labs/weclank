import { afterEach, describe, expect, test } from "bun:test";
import { ChatTab } from "./chat-tab";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ChatTab", () => {
	test("keeps channel input focused while typing", () => {
		const tab = new ChatTab();
		tab.mount(document.body);

		try {
			const input = document.querySelector<HTMLInputElement>('[data-platform="twitch"]')!;

			input.focus();
			input.value = "weclank";
			input.dispatchEvent(new Event("input", { bubbles: true }));

			expect(document.activeElement).toBe(input);
			expect(document.querySelector<HTMLInputElement>('[data-platform="twitch"]')?.value).toBe("weclank");
		} finally {
			tab.destroy();
		}
	});
});
