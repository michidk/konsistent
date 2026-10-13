import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./loader.js";

const fixturesDir = resolve(import.meta.dirname, "../../../../e2e/fixtures");

describe("loadConfig", () => {
  it("loads a valid empty-config fixture", async () => {
    const result = await loadConfig({
      configPath: resolve(fixturesDir, "empty-config/konsistent.json"),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.version).toBe("v1");
      expect(result.config.conventions).toEqual([]);
    }
  });

  it("returns error for invalid-config fixture", async () => {
    const result = await loadConfig({
      configPath: resolve(fixturesDir, "invalid-config/konsistent.json"),
    });
    expect(result.success).toBe(false);
  });

  it("returns error when config file does not exist", async () => {
    const result = await loadConfig({
      configPath: "/nonexistent/path/konsistent.json",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Could not read config file");
    }
  });

  it("returns error for invalid JSON", async () => {
    const result = await loadConfig({
      configPath: resolve(import.meta.dirname, "schema.ts"),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  it("merges cliPlaceholders into every convention's placeholders map", async () => {
    const result = await loadConfig({
      cliPlaceholders: { providerId: "anthropic" },
      configPath: resolve(
        fixturesDir,
        "convention-placeholders/konsistent.json"
      ),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      for (const convention of result.config.conventions) {
        expect(convention.placeholders?.providerId).toBe("anthropic");
      }
    }
  });

  it("rejects a CLI placeholder that collides with a path-captured name", async () => {
    const result = await loadConfig({
      cliPlaceholders: { providerId: "openai" },
      configPath: resolve(fixturesDir, "placeholder-satisfies/konsistent.json"),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('--placeholder "providerId:openai"');
      expect(result.error).toContain('captures "{providerId}" from paths');
    }
  });
});

describe("loadConfig JSON5", () => {
  let tmpDir: string;
  const config = "{ /* config */ version: 'v1', conventions: [], }";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "konsistent-json5-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    writeFileSync(join(tmpDir, "konsistent.json5"), config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { force: true, recursive: true });
  });

  it("discovers konsistent.json5", async () => {
    expect(await loadConfig({})).toEqual({
      config: { conventions: [], version: "v1" },
      success: true,
    });
  });

  it("loads an explicit JSON5 path even when konsistent.json exists", async () => {
    writeFileSync(join(tmpDir, "konsistent.json"), "invalid");
    expect(
      await loadConfig({ configPath: join(tmpDir, "konsistent.json5") })
    ).toMatchObject({ success: true });
  });

  it("loads JSON5 syntax from konsistent.json and prefers it over konsistent.json5", async () => {
    writeFileSync(join(tmpDir, "konsistent.json"), config);
    writeFileSync(join(tmpDir, "konsistent.json5"), "invalid");
    expect(await loadConfig({})).toEqual({
      config: { conventions: [], version: "v1" },
      success: true,
    });
  });

  it("does not fall back when konsistent.json is invalid", async () => {
    writeFileSync(join(tmpDir, "konsistent.json"), "invalid");
    expect(await loadConfig({})).toEqual({
      error: `Invalid JSON5 in config file: ${join(tmpDir, "konsistent.json")}`,
      success: false,
    });
  });

  it("reports malformed JSON5 with its file path", async () => {
    const configPath = join(tmpDir, "konsistent.json5");
    writeFileSync(configPath, "{ version: 'v1', conventions: [ }");
    expect(await loadConfig({ configPath })).toEqual({
      error: `Invalid JSON5 in config file: ${configPath}`,
      success: false,
    });
  });

  it("validates JSON5 against the config schema", async () => {
    writeFileSync(join(tmpDir, "konsistent.json5"), "{ version: 'v2' }");
    expect(await loadConfig({})).toMatchObject({
      error: expect.stringContaining("Invalid config:"),
      success: false,
    });
  });
});

describe("loadConfig --config-package", () => {
  let tmpDir: string;
  let consumerDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "konsistent-loader-package-"));
    consumerDir = join(tmpDir, "consumer");
    mkdirSync(consumerDir, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(consumerDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
    vi.restoreAllMocks();
  });

  function setupPackage(opts: {
    packageName: string;
    packageJson?: Record<string, unknown>;
    configAtRoot?: boolean;
    configAtDist?: boolean;
    configAtCustomPath?: string;
  }): string {
    const {
      packageName,
      packageJson,
      configAtRoot,
      configAtDist,
      configAtCustomPath,
    } = opts;

    const pkgDir = join(consumerDir, "node_modules", ...packageName.split("/"));
    mkdirSync(pkgDir, { recursive: true });

    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(
        packageJson ?? { name: packageName, type: "module", version: "0.0.0" }
      )
    );

    const validConfig = JSON.stringify({
      conventions: [],
      version: "v1",
    });

    if (configAtRoot) {
      writeFileSync(join(pkgDir, "konsistent.json"), validConfig);
    }
    if (configAtDist) {
      mkdirSync(join(pkgDir, "dist"), { recursive: true });
      writeFileSync(join(pkgDir, "dist", "konsistent.json"), validConfig);
    }
    if (configAtCustomPath !== undefined) {
      const target = join(pkgDir, configAtCustomPath);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, validConfig);
    }

    return pkgDir;
  }

  it.each(["konsistent.json5", "dist/konsistent.json5", "custom/config.json5"])(
    "loads JSON5 from a package at %s",
    async (configAtCustomPath) => {
      const packageJson: Record<string, unknown> = { name: "json5-config" };
      if (configAtCustomPath.startsWith("custom/")) {
        packageJson.konsistent = configAtCustomPath;
      }
      const pkgDir = setupPackage({
        configAtCustomPath,
        packageJson,
        packageName: "json5-config",
      });
      writeFileSync(
        join(pkgDir, configAtCustomPath),
        "{ version: 'v1', conventions: [], }"
      );
      expect(await loadConfig({ configPackage: "json5-config" })).toMatchObject(
        {
          config: { conventions: [], version: "v1" },
          success: true,
        }
      );
    }
  );

  it("prefers JSON over JSON5 within a package directory", async () => {
    const pkgDir = setupPackage({
      configAtRoot: true,
      packageName: "both-formats",
    });
    writeFileSync(join(pkgDir, "konsistent.json5"), "invalid");
    expect(await loadConfig({ configPackage: "both-formats" })).toMatchObject({
      success: true,
    });
  });

  it("loads konsistent.json from the package root", async () => {
    setupPackage({ configAtRoot: true, packageName: "@scope/root-config" });

    const result = await loadConfig({ configPackage: "@scope/root-config" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.version).toBe("v1");
    }
  });

  it("loads konsistent.json from the dist folder", async () => {
    setupPackage({ configAtDist: true, packageName: "@scope/dist-config" });

    const result = await loadConfig({ configPackage: "@scope/dist-config" });
    expect(result.success).toBe(true);
  });

  it("prefers dist/ over root when both are present", async () => {
    const pkgDir = setupPackage({
      configAtDist: true,
      configAtRoot: true,
      packageName: "@scope/both",
    });

    writeFileSync(
      join(pkgDir, "konsistent.json"),
      JSON.stringify({ conventions: [], version: "v1" })
    );
    writeFileSync(
      join(pkgDir, "dist", "konsistent.json"),
      JSON.stringify({
        conventions: [
          {
            description: "Loaded from dist.",
            must: { haveType: "file" },
            name: "from-dist",
            paths: "src/*.ts",
          },
        ],
        version: "v1",
      })
    );

    const result = await loadConfig({ configPackage: "@scope/both" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.conventions).toHaveLength(1);
      expect(result.config.conventions[0].name).toBe("from-dist");
    }
  });

  it('respects an explicit package.json "konsistent" field', async () => {
    setupPackage({
      configAtCustomPath: "build/my-config.json",
      packageJson: {
        konsistent: "./build/my-config.json",
        name: "@scope/explicit-field",
        type: "module",
        version: "0.0.0",
      },
      packageName: "@scope/explicit-field",
    });

    const result = await loadConfig({
      configPackage: "@scope/explicit-field",
    });
    expect(result.success).toBe(true);
  });

  it("errors when the package is not installed", async () => {
    const result = await loadConfig({
      configPackage: "@konsistent-test/definitely-not-installed",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(
        "@konsistent-test/definitely-not-installed"
      );
      expect(result.error).toContain("not installed");
    }
  });

  it("errors when the package contains no konsistent.json", async () => {
    setupPackage({ packageName: "@scope/no-config" });

    const result = await loadConfig({ configPackage: "@scope/no-config" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(
        "no konsistent.json or konsistent.json5 found"
      );
      expect(result.error).toContain("dist/konsistent.json");
      expect(result.error).toContain("/konsistent.json");
    }
  });

  it("errors when both --config-path and --config-package are passed", async () => {
    const result = await loadConfig({
      configPackage: "@scope/some-pkg",
      configPath: "/some/path/konsistent.json",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("--config-path");
      expect(result.error).toContain("--config-package");
    }
  });

  it("rejects path-form values", async () => {
    const result = await loadConfig({ configPackage: "./local-config" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("looks like a filesystem path");
      expect(result.error).toContain("--config-path");
    }
  });

  it("rejects absolute-path values", async () => {
    const result = await loadConfig({ configPackage: "/abs/path" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("looks like a filesystem path");
    }
  });

  it("rejects empty values", async () => {
    const result = await loadConfig({ configPackage: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("empty");
    }
  });

  it("rejects bare-package values with a subpath", async () => {
    const result = await loadConfig({ configPackage: "lodash/fp" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("subpath");
      expect(result.error).toContain('"lodash"');
    }
  });

  it("rejects scoped-package values with a subpath", async () => {
    const result = await loadConfig({ configPackage: "@scope/pkg/sub" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("subpath");
      expect(result.error).toContain('"@scope/pkg"');
    }
  });

  it('rejects a package.json "konsistent" field that escapes the package via ..', async () => {
    setupPackage({
      packageJson: {
        konsistent: "../../../../../../../etc/konsistent.json",
        name: "@scope/escape-relative",
        type: "module",
        version: "0.0.0",
      },
      packageName: "@scope/escape-relative",
    });

    const result = await loadConfig({
      configPackage: "@scope/escape-relative",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("outside the package directory");
    }
  });

  it('rejects a package.json "konsistent" field that is an absolute path', async () => {
    setupPackage({
      packageJson: {
        konsistent: "/etc/konsistent.json",
        name: "@scope/escape-absolute",
        type: "module",
        version: "0.0.0",
      },
      packageName: "@scope/escape-absolute",
    });

    const result = await loadConfig({
      configPackage: "@scope/escape-absolute",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("outside the package directory");
    }
  });
});
