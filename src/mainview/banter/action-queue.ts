import type { ParticipantId } from "../core/ids";
import type { ToolInvocation } from "./tools";

export type AgentActionRisk = "low" | "medium" | "high";
export type AgentActionStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export interface QueuedAgentAction {
	id: string;
	ts: number;
	participantId: ParticipantId | null;
	agentName: string;
	invocation: ToolInvocation;
	risk: AgentActionRisk;
	status: AgentActionStatus;
	reason: string;
	error?: string;
}

type Listener = (actions: QueuedAgentAction[]) => void;

class AgentActionQueue {
	private actions: QueuedAgentAction[] = [];
	private listeners: Listener[] = [];

	add(action: Omit<QueuedAgentAction, "id" | "ts" | "status">): QueuedAgentAction {
		const next: QueuedAgentAction = {
			...action,
			id: `act-${crypto.randomUUID().slice(0, 8)}`,
			ts: Date.now(),
			status: "pending",
		};
		this.actions = [next, ...this.actions].slice(0, 80);
		this.emit();
		return next;
	}

	all(): QueuedAgentAction[] {
		return this.actions;
	}

	pending(): QueuedAgentAction[] {
		return this.actions.filter((action) => action.status === "pending");
	}

	find(id: string): QueuedAgentAction | null {
		return this.actions.find((action) => action.id === id) ?? null;
	}

	mark(id: string, patch: Partial<Pick<QueuedAgentAction, "status" | "error">>): void {
		this.actions = this.actions.map((action) => action.id === id ? { ...action, ...patch } : action);
		this.emit();
	}

	reject(id: string): void {
		this.mark(id, { status: "rejected" });
	}

	clear(): void {
		this.actions = [];
		this.emit();
	}

	subscribe(listener: Listener): () => void {
		this.listeners.push(listener);
		listener(this.actions);
		return () => {
			this.listeners = this.listeners.filter((entry) => entry !== listener);
		};
	}

	private emit(): void {
		for (const listener of this.listeners) listener(this.actions);
	}
}

export const agentActionQueue = new AgentActionQueue();
