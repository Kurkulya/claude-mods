// Usage: node tools/sync-live.mjs [ref] [--to <dir>]
// Mirrors the files git tracks under workflow-bar/ at <ref> (default main) into <dir> (default
// <repo parent>/claude-mods-live/workflow-bar), so Claude Code loads the bar from a folder that is not in the repo.
// Writes every file (a temp name, then rename), deletes target files the ref does not track, touches nothing else.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "workflow-bar";

const args = process.argv.slice(2);
let ref = "main";
let to = join(dirname(repo), "claude-mods-live", SRC);
for (let i = 0, positional = 0; i < args.length; i++) {
  if (args[i] === "--to" && args[i + 1]) to = args[++i];
  else if (args[i].startsWith("-") || positional++) usage();
  else ref = args[i];
}
const target = resolve(to);

function usage() {
  console.error("usage: node tools/sync-live.mjs [ref] [--to <dir>]");
  process.exit(2);
}

function fail(message) {
  console.error(`sync-live: ${message}`);
  process.exit(1);
}

function git(...gitArgs) {
  return execFileSync("git", ["-C", repo, ...gitArgs], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
}

// A target inside the repo would make the live copy a protected plugin folder again.
const rel = relative(repo, target);
if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail(`target ${target} is inside the repo ${repo}`);

let sha;
try {
  sha = git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).toString().trim();
} catch {
  fail(`unknown ref "${ref}" in ${repo}`);
}
const short = git("rev-parse", "--short", sha).toString().trim();

const tracked = git("ls-tree", "-r", "-z", "--name-only", sha, "--", SRC)
  .toString()
  .split("\0")
  .filter(Boolean)
  .map((p) => p.slice(SRC.length + 1));
if (tracked.length === 0) fail(`no files under ${SRC}/ at ${ref}; the live copy is left as it is`);
if (tracked.some((p) => p.split("/").includes(".."))) fail(`ref ${ref} tracks a path with ".."`);

// The prune below deletes whatever the ref does not track, so only a missing or empty folder, or an earlier live
// copy (its plugin.json names workflow-bar), may be the target. A wrong --to then stops here with nothing touched.
if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) {
  let name;
  try {
    name = JSON.parse(readFileSync(join(target, ".claude-plugin", "plugin.json"), "utf8")).name;
  } catch {}
  if (name !== SRC) fail(`target ${target} is not empty and not an earlier live copy (no .claude-plugin/plugin.json named ${SRC}); nothing was touched`);
}

mkdirSync(target, { recursive: true });
for (const file of tracked) {
  const dest = join(target, file);
  const content = git("show", `${sha}:${SRC}/${file}`);
  mkdirSync(dirname(dest), { recursive: true });
  // Same bytes already there: leave the file alone, so a hot reload sees no change.
  if (existsSync(dest) && readFileSync(dest).equals(content)) continue;
  const tmp = join(dirname(dest), `.${file.split("/").pop()}.sync-tmp`);
  writeFileSync(tmp, content);
  renameSync(tmp, dest);
}

// Remove what the ref does not track: files first, then folders left empty.
const keep = new Set(tracked);
let removed = 0;
(function prune(dir, prefix) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      prune(join(dir, e.name), `${prefix}${e.name}/`);
      if (readdirSync(join(dir, e.name)).length === 0) rmdirSync(join(dir, e.name));
    } else if (!keep.has(prefix + e.name)) {
      unlinkSync(join(dir, e.name));
      removed++;
    }
  }
})(target, "");

console.log(`${ref} ${short} → ${target} (${tracked.length} files, ${removed} removed)`);
