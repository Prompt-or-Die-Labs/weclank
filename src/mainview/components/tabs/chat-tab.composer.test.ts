// Verifies the new chat-tab composer wires to banterEngine.broadcast()
// and echoes the user's send as a [me] row. No external services touched.

import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { ChatTab } from "./chat-tab";
import { banterEngine } from "../../banter/banter-engine";

let originalBroadcast: typeof banterEngine.broadcast | undefined;

beforeEach(() => {
	if (typeof banterEngine.broadcast === "function") {
		originalBroadcast = banterEngine.broadcast.bind(banterEngine);
	}
});

afterEach(() => {
	document.body.innerHTML = "";
	if (originalBroadcast) {
		(banterEngine as unknown as { broadcast: typeof banterEngine.broadcast }).broadcast = originalBroadcast;
	}
});

describe("ChatTab composer", () => {
	test("submit sends through banterEngine.broadcast and echoes [me] row", () => {
		const broadcastSpy = mock(() => {});
		(banterEngine as unknown as { broadcast: typeof banterEngine.broadcast }).broadcast = broadcastSpy as unknown as typeof banterEngine.broadcast;

		const tab = new ChatTab();
		tab.mount(document.body);

		try {
			const input = document.querySelector<HTMLInputElement>(".tab-chat__composer-input")!;
			const form = document.querySelector<HTMLFormElement>(".tab-chat__composer")!;

			expect(input).toBeTruthy();
			expect(form).toBeTruthy();

			input.value = "hey agents, hello";
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

			expect(broadcastSpy).toHaveBeenCalledTimes(1);
			const calls = broadcastSpy.mock.calls as unknown as Array<[{ author: string; text: string; meta?: Record<string, string> }]>;
			const arg = calls[0]![0];
			expect(arg.author).toBe("[me]");
			expect(arg.text).toBe("hey agents, hello");
			expect(arg.meta?.["source"]).toBe("user-chat");

			const selfRow = document.querySelector(".tab-chat__row--self");
			expect(selfRow?.textContent).toContain("hey agents, hello");

			expect(input.value).toBe("");
		} finally {
			tab.destroy();
		}
	});

	test("empty submit is a no-op", () => {
		const broadcastSpy = mock(() => {});
		(banterEngine as unknown as { broadcast: typeof banterEngine.broadcast }).broadcast = broadcastSpy as unknown as typeof banterEngine.broadcast;

		const tab = new ChatTab();
		tab.mount(document.body);
		try {
			const form = document.querySelector<HTMLFormElement>(".tab-chat__composer")!;
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			expect(broadcastSpy).not.toHaveBeenCalled();
		} finally {
			tab.destroy();
		}
	});
});
