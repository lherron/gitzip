#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync, rmSync, readFileSync, statSync } from "fs";
import { join } from "path";

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

function parseRepoArg(arg: string): { user: string; repo: string; branch?: string } {
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
  console.log("Usage: gitzip [-f <output>] <repo|user/repo>[@branch]");
  if (DEFAULT_USER) {
    console.log(`  If no user specified, defaults to '${DEFAULT_USER}'`);
  } else {
    console.log("  Set GITZIP_DEFAULT_USER env var to enable shorthand usage");
  }
  console.log("\nOptions:");
  console.log("  -f <path>    Output filename/path (default: <repo>.zip in cwd)");
  console.log("  @branch      Clone specific branch (default: default branch)");
  console.log("\nExamples:");
  console.log("  gitzip myrepo              # Creates myrepo.zip");
  console.log("  gitzip octocat/hello       # Creates hello.zip");
  console.log("  gitzip -f out.zip myrepo   # Creates out.zip");
  console.log("  gitzip user/repo@develop   # Creates repo.zip from develop branch");
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

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const { repo: repoArg, outputPath } = parseArgs(args);
  const { user, repo, branch } = parseRepoArg(repoArg);
  const repoUrl = `git@github.com:${user}/${repo}.git`;
  const tmpDir = `/tmp/gitzip-${repo}-${Date.now()}`;
  const cwd = process.cwd();

  // Resolve output path
  let zipPath: string;
  if (outputPath) {
    zipPath = outputPath.startsWith("/") ? outputPath : join(cwd, outputPath);
    if (!zipPath.endsWith(".zip")) {
      zipPath += ".zip";
    }
  } else {
    zipPath = join(cwd, `${repo}.zip`);
  }

  const branchInfo = branch ? ` (branch: ${branch})` : "";
  console.log(`Cloning ${user}/${repo}${branchInfo}...`);

  try {
    // Clone the repo
    if (branch) {
      await $`git clone --depth 1 --branch ${branch} ${repoUrl} ${tmpDir}`.quiet();
    } else {
      await $`git clone --depth 1 ${repoUrl} ${tmpDir}`.quiet();
    }
    console.log(`Cloned to ${tmpDir}`);

    // Remove .git directory to avoid including git history
    const gitDir = join(tmpDir, ".git");
    if (existsSync(gitDir)) {
      rmSync(gitDir, { recursive: true, force: true });
    }

    // Remove existing zip if present so we create fresh, not update
    if (existsSync(zipPath)) {
      rmSync(zipPath, { force: true });
    }

    // Create zip file
    console.log(`Creating ${zipPath}...`);
    await $`cd ${tmpDir} && zip -r ${zipPath} .`.quiet();
    const sizeMB = (statSync(zipPath).size / (1024 * 1024)).toFixed(2);
    console.log(`Created ${zipPath} (${sizeMB} MB)`);

  } catch (error: any) {
    if (error?.exitCode === 128) {
      console.error(`Error: Repository '${user}/${repo}' not found or not accessible`);
    } else {
      console.error(`Error: ${error?.stderr?.toString().trim() || error}`);
    }
    process.exit(1);
  } finally {
    // Cleanup: remove the cloned repo
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
      console.log(`Cleaned up ${tmpDir}`);
    }
  }
}

main();
