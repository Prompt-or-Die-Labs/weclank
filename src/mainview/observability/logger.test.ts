import { describe, expect, mock, test, afterEach } from "bun:test";
import {
	currentBroadcastSessionId,
	logger,
	noopLogger,
	setBroadcastSessionId,
	setLogger,
} from "./logger";

const originalConsole = {
	log: console.log,
	warn: console.warn,
	error: console.error,
	debug: console.debug,
};

afterEach(() => {
	console.log = originalConsole.log;
	console.warn = originalConsole.warn;
	console.error = originalConsole.error;
	console.debug = originalConsole.debug;
	setBroadcastSessionId(undefined);
});

describe("ConsoleLogger (default)", () => {
	test("info emits to console.log", () => {
		const captured: unknown[][] = [];
		console.log = mock((...args: unknown[]) => captured.push(args));
		logger().info("hello");
		expect(captured).toHaveLength(1);
		expect(captured[0]?.[0]).toBe("[info] hello");
	});

	test("warn emits to console.warn with fields", () => {
		const captured: unknown[][] = [];
		console.warn = mock((...args: unknown[]) => captured.push(args));
		logger().warn("oops", { dest: "twitch" });
		expect(captured[0]?.[0]).toBe("[warn] oops");
		expect(captured[0]?.[1]).toEqual({ dest: "twitch" });
	});

	test("withField is chainable", () => {
		const captured: unknown[][] = [];
		console.log = mock((...args: unknown[]) => captured.push(args));
		logger().withField("a", 1).withField("b", 2).info("msg");
		expect(captured[0]?.[1]).toEqual({ a: 1, b: 2 });
	});

	test("withError flattens Error to {err, stack}", () => {
		const captured: unknown[][] = [];
		console.error = mock((...args: unknown[]) => captured.push(args));
		const err = new Error("boom");
		logger().withError(err).error("failed");
		const fields = captured[0]?.[1] as { err: string; stack?: string };
		expect(fields.err).toBe("boom");
		expect(fields.stack).toContain("Error: boom");
	});

	test("withCorrelationId injects correlation_id field", () => {
		const captured: unknown[][] = [];
		console.log = mock((...args: unknown[]) => captured.push(args));
		logger().withCorrelationId("abc123").info("msg");
		const fields = captured[0]?.[1] as { correlation_id: string };
		expect(fields.correlation_id).toBe("abc123");
	});
});

describe("broadcast session correlation", () => {
	test("setBroadcastSessionId auto-injects on every logger() call", () => {
		const captured: unknown[][] = [];
		console.log = mock((...args: unknown[]) => captured.push(args));

		setBroadcastSessionId("session-123");
		logger().info("during broadcast");
		expect(captured[0]?.[1]).toEqual({ correlation_id: "session-123" });

		setBroadcastSessionId(undefined);
		logger().info("after broadcast");
		// With no session id, the fields object is omitted entirely.
		expect(captured[1]?.[1]).toBeUndefined();
	});

	test("currentBroadcastSessionId reflects setBroadcastSessionId", () => {
		expect(currentBroadcastSessionId()).toBeUndefined();
		setBroadcastSessionId("foo");
		expect(currentBroadcastSessionId()).toBe("foo");
	});
});

describe("NoOpLogger", () => {
	test("all methods are silent and chainable", () => {
		const captured: unknown[][] = [];
		console.log = mock((...args: unknown[]) => captured.push(args));

		// We can swap to noop for the duration of this test.
		const noop = noopLogger;
		noop.info("nothing");
		noop.warn("nothing");
		noop.error("nothing");
		noop.debug("nothing");
		noop.withField("a", 1).info("still nothing");
		noop.withError(new Error("e")).info("nothing");
		noop.withCorrelationId("x").info("nothing");

		expect(captured).toHaveLength(0);
	});

	test("setLogger can swap the global", () => {
		const captured: unknown[][] = [];
		console.log = mock((...args: unknown[]) => captured.push(args));
		setLogger(noopLogger);
		logger().info("should not log");
		expect(captured).toHaveLength(0);
		// Restore default.
		setLogger(originalLogger());
	});
});

// Helper: rebuild a ConsoleLogger-equivalent after a test that swapped
// the global to NoOp. Forwards everything to console.* with the same
// shape ConsoleLogger uses.
function originalLogger(): import("./logger").Logger {
	type Fields = Record<string, unknown>;
	type LogFn = (msg: string, fields?: Fields) => void;
	const log =
		(level: "info" | "warn" | "error" | "debug"): LogFn =>
		(msg, fields) => {
			const sink = level === "info" ? console.log : console[level];
			if (fields && Object.keys(fields).length > 0) sink(`[${level}] ${msg}`, fields);
			else sink(`[${level}] ${msg}`);
		};
	const self: import("./logger").Logger = {
		info: log("info"),
		warn: log("warn"),
		error: log("error"),
		debug: log("debug"),
		withField: () => self,
		withFields: () => self,
		withError: () => self,
		withCorrelationId: () => self,
	};
	return self;
}
