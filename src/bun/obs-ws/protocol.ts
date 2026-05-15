// obs-websocket v5 wire protocol — message envelope, opcodes, and
// event-subscription bitmask. All facts from the public protocol spec
// (https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md);
// the spec is documented under a license that doesn't restrict
// re-implementing the wire protocol.

/** Opcode for the `op` field. Every frame is `{op, d}`. */
export const OpCode = {
	Hello: 0,
	Identify: 1,
	Identified: 2,
	Reidentify: 3,
	Event: 5,
	Request: 6,
	RequestResponse: 7,
	RequestBatch: 8,
	RequestBatchResponse: 9,
} as const;

export type OpCode = typeof OpCode[keyof typeof OpCode];

export const RPC_VERSION = 1;

/** WebSocketCloseCode subset — only the ones a client should observe. */
export const CloseCode = {
	UnknownReason: 4000,
	MessageDecodeError: 4002,
	MissingDataField: 4003,
	InvalidDataFieldType: 4004,
	InvalidDataFieldValue: 4005,
	UnknownOpCode: 4006,
	NotIdentified: 4007,
	AlreadyIdentified: 4008,
	AuthenticationFailed: 4009,
	UnsupportedRpcVersion: 4010,
	SessionInvalidated: 4011,
} as const;

/** Event subscription bitmask. Clients send the bits they want; the
 *  server filters event emission accordingly. */
export const EventSubscription = {
	None: 0,
	General: 1 << 0,
	Config: 1 << 1,
	Scenes: 1 << 2,
	Inputs: 1 << 3,
	Transitions: 1 << 4,
	Filters: 1 << 5,
	Outputs: 1 << 6,
	SceneItems: 1 << 7,
	MediaInputs: 1 << 8,
	Vendors: 1 << 9,
	Ui: 1 << 10,
	All: (1 << 11) - 1,
	// High-volume subscriptions are opt-in:
	InputVolumeMeters: 1 << 16,
	InputActiveStateChanged: 1 << 17,
	InputShowStateChanged: 1 << 18,
	SceneItemTransformChanged: 1 << 19,
} as const;

/** Request status codes — primary success indicator goes in
 *  `requestStatus.result` (boolean) + `code` numeric. */
export const RequestStatusCode = {
	Unknown: 0,
	NoError: 10,
	Success: 100,
	MissingRequestType: 203,
	UnknownRequestType: 204,
	GenericError: 205,
	UnsupportedRequestBatchExecutionType: 206,
	NotReady: 207,
	MissingRequestField: 300,
	MissingRequestData: 301,
	InvalidRequestField: 400,
	InvalidRequestFieldType: 401,
	RequestFieldOutOfRange: 402,
	RequestFieldEmpty: 403,
	TooManyRequestFields: 404,
	OutputRunning: 500,
	OutputNotRunning: 501,
	OutputPaused: 502,
	OutputNotPaused: 503,
	OutputDisabled: 504,
	StudioModeActive: 505,
	StudioModeNotActive: 506,
	ResourceNotFound: 600,
	ResourceAlreadyExists: 601,
	InvalidResourceType: 602,
	NotEnoughResources: 603,
	InvalidResourceState: 604,
	InvalidInputKind: 605,
	ResourceNotConfigurable: 606,
	InvalidFilterKind: 607,
	ResourceCreationFailed: 700,
	ResourceActionFailed: 701,
	RequestProcessingFailed: 702,
	CannotAct: 703,
} as const;

// ---- Frame types (typed payloads) ---------------------------------

export interface HelloD {
	obsWebSocketVersion: string;
	rpcVersion: number;
	authentication?: { challenge: string; salt: string };
}

export interface IdentifyD {
	rpcVersion: number;
	authentication?: string;
	eventSubscriptions?: number;
}

export interface IdentifiedD {
	negotiatedRpcVersion: number;
}

export interface ReidentifyD {
	eventSubscriptions?: number;
}

export interface EventD {
	eventType: string;
	eventIntent: number; // which subscription bit emitted it
	eventData?: Record<string, unknown>;
}

export interface RequestD {
	requestType: string;
	requestId: string;
	requestData?: Record<string, unknown>;
}

export interface RequestResponseD {
	requestType: string;
	requestId: string;
	requestStatus: {
		result: boolean;
		code: number;
		comment?: string;
	};
	responseData?: Record<string, unknown>;
}

export type Frame =
	| { op: 0; d: HelloD }
	| { op: 1; d: IdentifyD }
	| { op: 2; d: IdentifiedD }
	| { op: 3; d: ReidentifyD }
	| { op: 5; d: EventD }
	| { op: 6; d: RequestD }
	| { op: 7; d: RequestResponseD };

export function encodeFrame(frame: Frame): string {
	return JSON.stringify(frame);
}

export function parseFrame(raw: string): Frame | { error: number } {
	let parsed: { op: number; d: Record<string, unknown> };
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: CloseCode.MessageDecodeError };
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { error: CloseCode.MessageDecodeError };
	}
	if (typeof parsed.op !== "number") {
		return { error: CloseCode.UnknownOpCode };
	}
	if (typeof parsed.d !== "object" || parsed.d === null) {
		return { error: CloseCode.MissingDataField };
	}
	switch (parsed.op) {
		case 0: case 1: case 2: case 3: case 5: case 6: case 7:
			return parsed as unknown as Frame;
		default:
			return { error: CloseCode.UnknownOpCode };
	}
}
