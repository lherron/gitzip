#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync, rmSync, readFileSync, statSync, mkdtempSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Load .env from script directory
const scriptDir = import.meta.dir;
const envPath = join(scriptDir, ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...rest] = trimmed.split("=");
      const value = rest.join("=");
      if (key && value !== undefined && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const DEFAULT_USER = process.env.GITZIP_DEFAULT_USER;

interface RepoSpec {
  user: string;
  repo: string;
  branch?: string;
}

function parseRepoArg(arg: string): RepoSpec {
  // Extract optional @branch suffix
  let branch: string | undefined;
  let repoSpec = arg;
  if (arg.includes("@")) {
    const atIndex = arg.lastIndexOf("@");
    branch = arg.slice(atIndex + 1);
    repoSpec = arg.slice(0, atIndex);
  }

  if (repoSpec.includes("/")) {
    const [user, repo] = repoSpec.split("/", 2);
    return { user, repo, branch };
  }
  if (!DEFAULT_USER) {
    console.error("Error: No user specified and GITZIP_DEFAULT_USER is not set");
    console.error("  Either use 'user/repo' format or set GITZIP_DEFAULT_USER env var");
    process.exit(1);
  }
  return { user: DEFAULT_USER, repo: repoSpec, branch };
}

function printUsage() {
  console.log("Usage: gitzip [-f <output>] <repo|user/repo>[@branch][,<repo>...]");
  if (DEFAULT_USER) {
    console.log(`  If no user specified, defaults to '${DEFAULT_USER}'`);
  } else {
    console.log("  Set GITZIP_DEFAULT_USER env var to enable shorthand usage");
  }
  console.log("\nOptions:");
  console.log("  -f <path>    Output filename/path (default: <repo>-<timestamp>.zip or <first>-bundle-<timestamp>.zip)");
  console.log("  @branch      Clone specific branch (default: default branch)");
  console.log("  ,            Comma-separate to bundle multiple repos into one zip");
  console.log("\nExamples:");
  console.log("  gitzip myrepo                       # Creates myrepo-<timestamp>.zip");
  console.log("  gitzip octocat/hello                # Creates hello-<timestamp>.zip");
  console.log("  gitzip -f out.zip myrepo            # Creates out.zip");
  console.log("  gitzip user/repo@develop            # Creates repo-<timestamp>.zip from develop branch");
  console.log("  gitzip foo,bar,baz                  # Creates foo-bundle-<timestamp>.zip with foo/, bar/, baz/");
}

function parseArgs(args: string[]): { repo: string; outputPath: string | null } {
  let outputPath: string | null = null;
  let repo: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-f" && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (!args[i].startsWith("-")) {
      repo = args[i];
    }
  }

  if (!repo) {
    console.error("Error: No repository specified");
    printUsage();
    process.exit(1);
  }

  return { repo, outputPath };
}

async function cloneRepo(spec: RepoSpec, destDir: string): Promise<void> {
  const repoUrl = `git@github.com:${spec.user}/${spec.repo}.git`;
  const branchInfo = spec.branch ? ` (branch: ${spec.branch})` : "";
  console.log(`Cloning ${spec.user}/${spec.repo}${branchInfo}...`);

  if (spec.branch) {
    await $`git clone --depth 1 --branch ${spec.branch} ${repoUrl} ${destDir}`.quiet();
  } else {
    await $`git clone --depth 1 ${repoUrl} ${destDir}`.quiet();
  }

  // Remove .git directory to avoid including git history
  const gitDir = join(destDir, ".git");
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true, force: true });
  }
}

function timestamp(): string {
  // Matches `date +%m%d%y%H%M%S` (the chatpack convention)
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getFullYear() % 100) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function defaultBasePrefix(specs: RepoSpec[]): string {
  // Prefix shared by all timestamped outputs for this repo set
  return specs.length === 1 ? `${specs[0].repo}-` : `${specs[0].repo}-bundle-`;
}

function resolveOutputPath(
  outputPath: string | null,
  specs: RepoSpec[],
  cwd: string,
): string {
  if (outputPath) {
    const p = outputPath.startsWith("/") ? outputPath : join(cwd, outputPath);
    return p.endsWith(".zip") ? p : `${p}.zip`;
  }
  return join(cwd, `${defaultBasePrefix(specs)}${timestamp()}.zip`);
}

function deletePreviousBundles(prefix: string, cwd: string): void {
  // Match prior timestamped zips for this repo set in code (no shell glob)
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{12}\\.zip$`);
  const matches = readdirSync(cwd).filter((name) => re.test(name));

  // Safety guard: refuse to mass-delete — abort without removing anything
  if (matches.length > 3) {
    console.error(
      `Error: refusing to delete ${matches.length} previous bundles matching '${prefix}<timestamp>.zip' (limit 3)`,
    );
    console.error(`  Remove them manually or use -f to choose an explicit output name`);
    process.exit(1);
  }

  for (const name of matches) {
    rmSync(join(cwd, name), { force: true });
    console.log(`Removed previous bundle ${name}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const { repo: repoArg, outputPath } = parseArgs(args);
  const tokens = repoArg.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    console.error("Error: No repository specified");
    printUsage();
    process.exit(1);
  }

  const specs = tokens.map(parseRepoArg);

  // Detect duplicate repo names (would collide in staging dir)
  const seen = new Set<string>();
  for (const s of specs) {
    if (seen.has(s.repo)) {
      console.error(`Error: Duplicate repo name '${s.repo}' in list — directory would collide`);
      process.exit(1);
    }
    seen.add(s.repo);
  }

  const cwd = process.cwd();
  const zipPath = resolveOutputPath(outputPath, specs, cwd);
  const stagingDir = mkdtempSync(join(tmpdir(), "gitzip-"));

  const cleanup = () => {
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
      console.log(`Cleaned up ${stagingDir}`);
    }
  };

  try {
    // Clone all repos in parallel into staging/<repo>
    await Promise.all(
      specs.map((spec) => cloneRepo(spec, join(stagingDir, spec.repo))),
    );

    // For default naming, remove prior timestamped bundles for this repo set
    if (!outputPath) {
      deletePreviousBundles(defaultBasePrefix(specs), cwd);
    }

    // Remove existing zip if present so we create fresh, not update
    if (existsSync(zipPath)) {
      rmSync(zipPath, { force: true });
    }

    console.log(`Creating ${zipPath}...`);
    if (specs.length === 1) {
      // Single repo: zip contents at the root (preserves prior behavior)
      const repoDir = join(stagingDir, specs[0].repo);
      await $`cd ${repoDir} && zip -r ${zipPath} .`.quiet();
    } else {
      // Multi repo: zip the staging dir's contents → repos appear as top-level dirs
      await $`cd ${stagingDir} && zip -r ${zipPath} .`.quiet();
    }
    const sizeMB = (statSync(zipPath).size / (1024 * 1024)).toFixed(2);
    console.log(`Created ${zipPath} (${sizeMB} MB)`);
    cleanup();
  } catch (error: any) {
    if (error?.exitCode === 128) {
      console.error(`Error: A repository was not found or not accessible`);
      const stderr = error?.stderr?.toString().trim();
      if (stderr) console.error(`  ${stderr}`);
    } else {
      console.error(`Error: ${error?.stderr?.toString().trim() || error}`);
    }
    cleanup();
    process.exit(1);
  }
}

main();
