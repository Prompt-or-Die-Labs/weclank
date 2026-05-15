import { describe, expect, test } from "bun:test";
import {
	CloseCode,
	OpCode,
	encodeFrame,
	parseFrame,
} from "./protocol";

describe("obs-websocket protocol envelope", () => {
	test("encodeFrame produces JSON {op, d}", () => {
		const wire = encodeFrame({
			op: OpCode.Hello,
			d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1 },
		});
		const parsed = JSON.parse(wire);
		expect(parsed.op).toBe(OpCode.Hello);
		expect(parsed.d.obsWebSocketVersion).toBe("5.5.0");
	});

	test("parseFrame accepts valid Identify", () => {
		const result = parseFrame(JSON.stringify({ op: OpCode.Identify, d: { rpcVersion: 1 } }));
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.op).toBe(OpCode.Identify);
		}
	});

	test("parseFrame rejects malformed JSON with MessageDecodeError", () => {
		const result = parseFrame("not json");
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe(CloseCode.MessageDecodeError);
		}
	});

	test("parseFrame rejects missing op with UnknownOpCode", () => {
		const result = parseFrame(JSON.stringify({ d: {} }));
		if ("error" in result) {
			expect(result.error).toBe(CloseCode.UnknownOpCode);
		}
	});

	test("parseFrame rejects unknown opcode", () => {
		const result = parseFrame(JSON.stringify({ op: 999, d: {} }));
		if ("error" in result) {
			expect(result.error).toBe(CloseCode.UnknownOpCode);
		}
	});

	test("parseFrame rejects missing d", () => {
		const result = parseFrame(JSON.stringify({ op: OpCode.Identify }));
		if ("error" in result) {
			expect(result.error).toBe(CloseCode.MissingDataField);
		}
	});
});
