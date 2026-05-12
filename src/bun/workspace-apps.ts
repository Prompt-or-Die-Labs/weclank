export type WorkspaceAppId =
	| "windsurf"
	| "antigravity"
	| "cursor"
	| "vscode"
	| "terminal"
	| "claude"
	| "codex";

export interface WorkspaceApp {
	id: WorkspaceAppId;
	label: string;
	description: string;
}

type Platform = NodeJS.Platform;

export interface LaunchPlan {
	command: string[];
	cwd?: string;
}

const APPS: WorkspaceApp[] = [
	{ id: "windsurf", label: "Windsurf", description: "Open this project in Windsurf." },
	{ id: "antigravity", label: "Antigravity", description: "Open this project in Antigravity." },
	{ id: "cursor", label: "Cursor", description: "Open this project in Cursor." },
	{ id: "vscode", label: "VS Code", description: "Open this project in Visual Studio Code." },
	{ id: "terminal", label: "Terminal", description: "Open a terminal at this project." },
	{ id: "claude", label: "Claude", description: "Open Claude for side-by-side planning." },
	{ id: "codex", label: "Codex", description: "Open Codex for agent work." },
];

export function listWorkspaceApps(): WorkspaceApp[] {
	return APPS.map((app) => ({ ...app }));
}

export function getWorkspaceApp(id: WorkspaceAppId): WorkspaceApp {
	const app = APPS.find((candidate) => candidate.id === id);
	if (!app) throw new Error(`Unknown workspace app: ${id}`);
	return app;
}

export function buildWorkspaceLaunchPlans(id: WorkspaceAppId, platform: Platform, cwd: string): LaunchPlan[] {
	switch (platform) {
		case "darwin":
			return buildMacPlans(id, cwd);
		case "win32":
			return buildWindowsPlans(id, cwd);
		default:
			return buildLinuxPlans(id, cwd);
	}
}

function buildMacPlans(id: WorkspaceAppId, cwd: string): LaunchPlan[] {
	switch (id) {
		case "terminal":
			return [{ command: ["open", "-a", "Terminal", cwd] }];
		case "vscode":
			return [{ command: ["open", "-a", "Visual Studio Code", cwd] }, { command: ["code", cwd] }];
		case "cursor":
			return [{ command: ["open", "-a", "Cursor", cwd] }, { command: ["cursor", cwd] }];
		case "windsurf":
			return [{ command: ["open", "-a", "Windsurf", cwd] }, { command: ["windsurf", cwd] }];
		case "antigravity":
			return [{ command: ["open", "-a", "Antigravity", cwd] }, { command: ["open", "-a", "Google Antigravity", cwd] }, { command: ["antigravity", cwd] }];
		case "claude":
			return [{ command: ["open", "-a", "Claude"] }, { command: ["claude"], cwd }];
		case "codex":
			return [{ command: ["open", "-a", "Codex"] }, { command: ["codex"], cwd }];
	}
}

function buildLinuxPlans(id: WorkspaceAppId, cwd: string): LaunchPlan[] {
	switch (id) {
		case "terminal":
			return [{ command: ["x-terminal-emulator"], cwd }, { command: ["gnome-terminal"], cwd }, { command: ["konsole"], cwd }];
		case "vscode":
			return [{ command: ["code", cwd] }];
		case "cursor":
			return [{ command: ["cursor", cwd] }];
		case "windsurf":
			return [{ command: ["windsurf", cwd] }];
		case "antigravity":
			return [{ command: ["antigravity", cwd] }];
		case "claude":
			return [{ command: ["claude"], cwd }];
		case "codex":
			return [{ command: ["codex"], cwd }];
	}
}

function buildWindowsPlans(id: WorkspaceAppId, cwd: string): LaunchPlan[] {
	switch (id) {
		case "terminal":
			return [{ command: ["cmd", "/c", "start", "", "wt", "-d", cwd] }, { command: ["cmd", "/c", "start", "", "cmd"], cwd }];
		case "vscode":
			return [{ command: ["cmd", "/c", "start", "", "code", cwd] }];
		case "cursor":
			return [{ command: ["cmd", "/c", "start", "", "cursor", cwd] }];
		case "windsurf":
			return [{ command: ["cmd", "/c", "start", "", "windsurf", cwd] }];
		case "antigravity":
			return [{ command: ["cmd", "/c", "start", "", "antigravity", cwd] }];
		case "claude":
			return [{ command: ["cmd", "/c", "start", "", "claude"] }];
		case "codex":
			return [{ command: ["cmd", "/c", "start", "", "codex"] }];
	}
}
