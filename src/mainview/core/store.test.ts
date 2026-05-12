import { describe, expect, test } from "bun:test";
import { Store } from "./store";

interface Counter {
	count: number;
	label: string;
}

describe("Store", () => {
	test("set merges partial state", () => {
		const s = new Store<Counter>({ count: 0, label: "init" });
		s.set({ count: 5 });
		expect(s.state).toEqual({ count: 5, label: "init" });
	});

	test("set accepts a function returning the patch", () => {
		const s = new Store<Counter>({ count: 0, label: "init" });
		s.set((prev) => ({ count: prev.count + 3 }));
		expect(s.state.count).toBe(3);
	});

	test("subscribe fires on every set with prev + next", () => {
		const s = new Store<Counter>({ count: 0, label: "a" });
		const calls: Array<{ count: number; prev: number }> = [];
		s.subscribe((next, prev) => calls.push({ count: next.count, prev: prev.count }));
		s.set({ count: 1 });
		s.set({ count: 2 });
		s.set({ count: 2 }); // identity changes (new object) — store fires regardless
		expect(calls).toEqual([
			{ count: 1, prev: 0 },
			{ count: 2, prev: 1 },
			{ count: 2, prev: 2 },
		]);
	});

	test("select only fires when the selected slice changes by identity", () => {
		const s = new Store<Counter>({ count: 0, label: "init" });
		const labelChanges: string[] = [];
		s.select((state) => state.label, (label) => labelChanges.push(label));
		// Mutating count shouldn't fire the label listener.
		s.set({ count: 1 });
		s.set({ count: 2 });
		expect(labelChanges).toEqual([]);
		s.set({ label: "next" });
		expect(labelChanges).toEqual(["next"]);
	});

	test("subscribe returns an unsubscriber", () => {
		const s = new Store<Counter>({ count: 0, label: "" });
		const calls: number[] = [];
		const off = s.subscribe(() => calls.push(s.state.count));
		s.set({ count: 1 });
		off();
		s.set({ count: 2 });
		expect(calls).toEqual([1]);
	});
});
