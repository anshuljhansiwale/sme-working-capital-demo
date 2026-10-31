import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GROK_MODEL_ID, REPOSITORY } from "../exception-service/constants.js";
import { runGreenBar } from "../exception-service/green-bar.js";

const execFileAsync = promisify(execFile);

async function git(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: process.cwd() });
  return stdout.trim();
}

let cached;

/** The running commit is the last green build when the section 5 bar passes. */
export async function resolveBuild({ checkGitHub = true, force = false } = {}) {
  if (cached && !force && !checkGitHub) return cached;

  let commit = null;
  let dirty = false;
  try {
    commit = await git(["rev-parse", "HEAD"]);
    dirty = (await git(["status", "--porcelain"])).length > 0;
  } catch {
    commit = null;
  }

  const green = runGreenBar(commit || "uncommitted");
  let onGitHub = false;
  if (checkGitHub && commit) {
    try {
      const response = await fetch(`${REPOSITORY.replace("https://github.com", "https://api.github.com/repos")}/commits/${commit}`, {
        headers: {
          "User-Agent": "sme-working-capital-demo",
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(4000),
      });
      onGitHub = response.status === 200;
    } catch {
      onGitHub = false;
    }
  }

  const build = {
    commit,
    repository: REPOSITORY,
    modelId: GROK_MODEL_ID,
    green: Boolean(commit) && green.passed,
    checks: green.checks,
    onGitHub,
    dirty,
    apiKeyPresent: Boolean(process.env.XAI_API_KEY),
  };
  cached = build;
  return build;
}
