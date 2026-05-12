import type { AgentAutonomyLevel, AgentToolPermissions, BanterConfig } from "../core/types";

export const SAFE_TOOL_PERMISSIONS: AgentToolPermissions = {
	controlOverlays: true,
	controlMusic: false,
};

export const FULL_TOOL_PERMISSIONS: AgentToolPermissions = {
	controlOverlays: true,
	controlMusic: true,
};

export function runtimeAutonomy(config: BanterConfig): AgentAutonomyLevel {
	return config.autonomyLevel ?? "full";
}

export function runtimeToolPermissions(config: BanterConfig): AgentToolPermissions {
	return config.toolPermissions ?? FULL_TOOL_PERMISSIONS;
}

