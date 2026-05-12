import { describe, expect, test } from "bun:test";
import { buildWorkspaceLaunchPlans, listWorkspaceApps } from "./workspace-apps";

describe("workspace app launch plans", () => {
	test("lists the requested creator tools", () => {
		expect(listWorkspaceApps().map((app) => app.id)).toEqual([
			"windsurf",
			"antigravity",
			"cursor",
			"vscode",
			"terminal",
			"claude",
			"codex",
		]);
	});

	test("opens mac IDEs with the project path", () => {
		expect(buildWorkspaceLaunchPlans("cursor", "darwin", "/repo")[0]?.command).toEqual(["open", "-a", "Cursor", "/repo"]);
		expect(buildWorkspaceLaunchPlans("vscode", "darwin", "/repo")[0]?.command).toEqual(["open", "-a", "Visual Studio Code", "/repo"]);
	});

	test("falls back for Antigravity naming on macOS", () => {
		const commands = buildWorkspaceLaunchPlans("antigravity", "darwin", "/repo").map((plan) => plan.command.join(" "));
		expect(commands).toContain("open -a Antigravity /repo");
		expect(commands).toContain("open -a Google Antigravity /repo");
	});

	test("uses command launchers on Linux", () => {
		expect(buildWorkspaceLaunchPlans("windsurf", "linux", "/repo")[0]?.command).toEqual(["windsurf", "/repo"]);
		expect(buildWorkspaceLaunchPlans("terminal", "linux", "/repo")[0]?.cwd).toBe("/repo");
	});
});
