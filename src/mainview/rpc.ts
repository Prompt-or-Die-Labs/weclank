// Single RPC entry point for the renderer. Constructed once at startup and
// imported wherever the view needs to call into Bun.

import Electrobun, { Electroview } from "electrobun/view";
import type { PhotoBoothRPC } from "../bun/index";

// Store the utility window kind if this is a utility window
let utilityWindowKind: string | null = null;

const rpc = Electroview.defineRPC<PhotoBoothRPC>({
	// Picking a multi-megabyte model file + base64 round-trip is well over
	// the 5-second default. Give it some breathing room.
	maxRequestTime: 60_000,
	handlers: {
		requests: {},
		messages: {
			// Handle utility window initialization
			initializeUtilityWindow: ({ id, kind }) => {
				console.log(`[RPC] Initializing utility window: ${kind} (id: ${id})`);
				utilityWindowKind = kind;
				// Dispatch can be handled by importing the store if needed
			},
			// Handle utility window lifecycle events from Bun
			utilityWindowReady: ({ id, kind }) => {
				console.log(`[RPC] Utility window ready: ${kind} (id: ${id})`);
			},
			utilityWindowClosed: ({ id, kind }) => {
				console.log(`[RPC] Utility window closed: ${kind} (id: ${id})`);
			},
		},
	},
});

const electroview = new Electrobun.Electroview({ rpc });

// Re-exported callable surface. Use `await bunRpc.<method>({...})` in
// components / factories that need to talk to the main process.
export const bunRpc = electroview.rpc!.request;

// Export utility window kind for use in index.ts
export function getUtilityWindowKind(): string | null {
	return utilityWindowKind;
}
