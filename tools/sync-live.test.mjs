// Tests for sync-live.mjs: each test builds a throwaway git repo in the OS temp dir, copies the script into its
// tools/ folder (the script finds its repo from its own location) and runs it as a child process.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "sync-live.mjs");
const PLUGIN = '{ "name": "workflow-bar" }\n';
const PJ = ".claude-plugin/plugin.json";
let root;
let n = 0;

before(() => { root = mkdtempSync(join(tmpdir(), "sync-live-test-")); });
after(() => { rmSync(root, { recursive: true, force: true }); });

function git(repo, ...args) {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

// <root>/<case>/repo is the repo, <root>/<case>/claude-mods-live is where the default target lands.
function makeRepo() {
  const base = join(root, `case-${++n}`);
  const repo = join(base, "repo");
  mkdirSync(join(repo, "tools"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "core.autocrlf", "false");
  copyFileSync(SCRIPT, join(repo, "tools", "sync-live.mjs"));
  put(repo, { "workflow-bar/.claude-plugin/plugin.json": PLUGIN });
  return { base, repo, target: join(base, "target") };
}

function put(repo, files) {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), content);
  }
}

function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "--short", "HEAD");
}

function sync(repo, ...args) {
  return spawnSync(process.execPath, [join(repo, "tools", "sync-live.mjs"), ...args], { encoding: "utf8" });
}

function tree(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tree(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  ).sort();
}

test("mirrors exactly the files tracked under workflow-bar/ and prints one summary line", () => {
  const { repo, target } = makeRepo();
  put(repo, {
    "workflow-bar/README.md": "readme\n",
    "workflow-bar/hooks/a.ts": "export const a = 1;\n",
    "workflow-bar/hooks/deep/b.ts": "export const b = 2;\n",
    "README.md": "outside\n",
    "tools/other.mjs": "outside\n",
  });
  const sha = commit(repo, "one");
  put(repo, { "workflow-bar/untracked.txt": "not committed\n" });

  const r = sync(repo, "--to", target);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(target), [PJ, "README.md", "hooks/a.ts", "hooks/deep/b.ts"]);
  assert.equal(readFileSync(join(target, "hooks/a.ts"), "utf8"), "export const a = 1;\n");
  assert.equal(r.stdout, `main ${sha} → ${target} (4 files, 0 removed)\n`);
});

test("a second sync applies changed, deleted and added files and removes stray target files", () => {
  const { base, repo, target } = makeRepo();
  put(repo, {
    "workflow-bar/keep.txt": "keep\n",
    "workflow-bar/change.txt": "old\n",
    "workflow-bar/gone/x.txt": "x\n",
    "workflow-bar/gone/y.txt": "y\n",
  });
  commit(repo, "one");
  assert.equal(sync(repo, "--to", target).status, 0);

  put(repo, { "workflow-bar/change.txt": "new\n", "workflow-bar/added/z.txt": "z\n" });
  rmSync(join(repo, "workflow-bar/gone"), { recursive: true });
  const sha = commit(repo, "two");
  writeFileSync(join(target, "stray.txt"), "left over\n");
  mkdirSync(join(base, "sibling"));
  writeFileSync(join(base, "sibling", "mine.txt"), "not the bar's\n");

  const r = sync(repo, "--to", target);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(target), [PJ, "added/z.txt", "change.txt", "keep.txt"]);
  assert.equal(readFileSync(join(target, "change.txt"), "utf8"), "new\n");
  assert.equal(existsSync(join(target, "gone")), false, "an emptied folder is removed too");
  assert.equal(r.stdout, `main ${sha} → ${target} (4 files, 3 removed)\n`);
  assert.equal(readFileSync(join(base, "sibling", "mine.txt"), "utf8"), "not the bar's\n");
});

test("writes the committed bytes as they are, binary and CRLF included", () => {
  const { repo, target } = makeRepo();
  const bytes = Buffer.from([0, 255, 13, 10, 1, 2, 13, 10]);
  put(repo, { "workflow-bar/bin.dat": bytes });
  commit(repo, "one");

  assert.equal(sync(repo, "--to", target).status, 0);

  assert.deepEqual(readFileSync(join(target, "bin.dat")), bytes);
});

test("a file whose content did not change is not rewritten, so a hot reload stays quiet", () => {
  const { repo, target } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");
  assert.equal(sync(repo, "--to", target).status, 0);
  const old = new Date(2020, 0, 1);
  utimesSync(join(target, "a.txt"), old, old);

  assert.equal(sync(repo, "--to", target).status, 0);

  assert.equal(statSync(join(target, "a.txt")).mtimeMs, old.getTime());
});

test("a ref other than main mirrors that ref, not the checked-out tree", () => {
  const { repo, target } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "main\n" });
  commit(repo, "one");
  git(repo, "checkout", "-q", "-b", "try");
  put(repo, { "workflow-bar/a.txt": "try\n", "workflow-bar/b.txt": "b\n" });
  const sha = commit(repo, "on try");
  git(repo, "checkout", "-q", "main");

  const r = sync(repo, "try", "--to", target);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(target), [PJ, "a.txt", "b.txt"]);
  assert.equal(readFileSync(join(target, "a.txt"), "utf8"), "try\n");
  assert.equal(r.stdout, `try ${sha} → ${target} (3 files, 0 removed)\n`);
});

test("the default target is claude-mods-live/workflow-bar next to the repo folder", () => {
  const { base, repo } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");

  const r = sync(repo);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(join(base, "claude-mods-live", "workflow-bar")), [PJ, "a.txt"]);
});

test("an unknown ref exits 1 with a message and leaves the target alone", () => {
  const { repo, target } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");
  assert.equal(sync(repo, "--to", target).status, 0);

  const r = sync(repo, "no-such-branch", "--to", target);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown ref.*no-such-branch/);
  assert.deepEqual(tree(target), [PJ, "a.txt"]);
});

test("an unknown option or a second ref exits 2 with the usage line and writes nothing", () => {
  const { repo, target } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");

  for (const extra of [["--output=oops"], ["main", "other"]]) {
    const r = sync(repo, ...extra, "--to", target);
    assert.equal(r.status, 2, extra.join(" "));
    assert.match(r.stderr, /usage:/);
  }
  assert.equal(existsSync(target), false);
});

test("a target inside the repo exits 1 and writes nothing", () => {
  const { repo } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");

  for (const inside of [join(repo, "workflow-bar"), join(repo, "live", "workflow-bar"), repo]) {
    const r = sync(repo, "--to", inside);
    assert.equal(r.status, 1, inside);
    assert.match(r.stderr, /inside the repo/);
  }
  assert.equal(existsSync(join(repo, "live")), false);
});

test("a ref without workflow-bar/ exits 1 instead of emptying the live copy", () => {
  const { repo, target } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");
  assert.equal(sync(repo, "--to", target).status, 0);
  git(repo, "checkout", "-q", "--orphan", "bare");
  git(repo, "rm", "-rfq", ".");
  put(repo, { "other.txt": "x\n" });
  commit(repo, "bare");
  git(repo, "checkout", "-q", "main");

  const r = sync(repo, "bare", "--to", target);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /no files under workflow-bar/);
  assert.deepEqual(tree(target), [PJ, "a.txt"]);
});

test("a non-empty folder that is not an earlier live copy exits 1 and every file stays", () => {
  const { base, repo } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");
  const foreign = {
    "home/notes.txt": "mine\n",
    "home/docs/plan.md": "plan\n",
    "noname/.claude-plugin/plugin.json": '{ "name": "other-plugin" }\n',
    "broken/.claude-plugin/plugin.json": "{ not json",
  };
  put(base, foreign);

  for (const dir of ["home", "noname", "broken"]) {
    const r = sync(repo, "--to", join(base, dir));
    assert.equal(r.status, 1, dir);
    assert.match(r.stderr, /not an earlier live copy/, dir);
  }
  for (const [name, content] of Object.entries(foreign)) {
    assert.equal(readFileSync(join(base, name), "utf8"), content, name);
  }
  assert.deepEqual(tree(join(base, "home")), ["docs/plan.md", "notes.txt"]);
});

test("an existing empty folder is fine, and engine-written files in a live copy are pruned", () => {
  const { base, repo, target } = makeRepo();
  put(repo, { "workflow-bar/a.txt": "a\n" });
  commit(repo, "one");
  mkdirSync(target);
  assert.equal(sync(repo, "--to", target).status, 0);
  put(target, { "tsconfig.json": "{}\n", ".claude-plugin/types/index.d.ts": "x\n" });

  const r = sync(repo, "--to", target);

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(target), [PJ, "a.txt"]);
  assert.match(r.stdout, /\(2 files, 2 removed\)\n$/);
  assert.ok(base);
});
