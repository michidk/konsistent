import { execFile as execFileCb } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCb);
const cliBinary = resolve(
  import.meta.dirname,
  "../packages/konsistent/dist/cli.js"
);
const cwd = resolve(import.meta.dirname, "fixtures/json5");

function runCli(args: string[]) {
  return execFile("node", [cliBinary, ...args], {
    cwd,
    env: {
      ...process.env,
      GITHUB_ACTIONS: "",
      KONSISTENT_NO_UPDATE_CHECK: "true",
    },
  });
}

describe("JSON5 configuration", () => {
  it("discovers and validates JSON5 with reusable conventions", async () => {
    const { stdout } = await runCli(["validate"]);
    expect(stdout).toContain("Configuration is valid");
  });

  it("checks conventions from JSON5 files", async () => {
    await expect(runCli(["check"])).resolves.not.toThrow();
  });

  it.each(["validate", "check"])(
    "accepts JSON5 syntax in .json files with %s",
    async (command) => {
      await expect(
        runCli([command, "--config-path", "config.json"])
      ).resolves.not.toThrow();
    }
  );

  it("reports violations from an explicit JSON5 configuration", async () => {
    await expect(
      runCli(["check", "--config-path", "broken.json5"])
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("missing"),
    });
  });
});
