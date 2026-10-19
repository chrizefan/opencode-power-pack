import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const version = process.argv[2] || "2.0.32";
const legacy = version.startsWith("1.");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginEntrypoint = pathToFileURL(
  path.join(repo, ".opencode/plugins/opencode-power-pack.js"),
).href;
const expectedSkills = readdirSync(path.join(repo, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const expectedAgents = ["code-architect", "code-explorer", "code-reviewer"];
const serverPassword = randomBytes(32).toString("base64url");
const authorization = `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`;

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(url, child, stderr, health) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`OpenCode exited early:\n${stderr.join("")}`);
    }
    try {
      const response = await fetch(health.url, {
        headers: { ...health.headers, Connection: "close" },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Startup can take a few seconds while npx resolves the pinned package.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for OpenCode:\n${stderr.join("")}`);
}

export async function fetchJson(url, timeoutMs = 10_000, retries = 5, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJsonOnce(url, timeoutMs, headers);
    } catch (error) {
      // The health endpoint can report ready slightly before OpenCode finishes
      // registering every plugin's skills. With enough skills, that window is
      // long enough for a socket to be reset mid-response. Retry with backoff
      // instead of failing on the first transient close.
      const transient = error.cause?.code === "UND_ERR_SOCKET" || error.name === "TimeoutError";
      if (!transient || attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export async function waitForEntries(url, ids, headers = {}, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let entries = [];
  do {
    const result = await fetchJson(url, Math.min(timeoutMs, 10_000), 5, headers);
    entries = result.data;
    if (Array.isArray(entries) && ids.every((id) => entries.some((entry) => entry.id === id))) return entries;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for catalog entries from ${url}; found: ${entries?.map((entry) => entry.id).join(", ")}`);
}

async function fetchJsonOnce(url, timeoutMs, headers) {
  try {
    // No `Connection: close` header here: pairing it with a large, still-being-
    // generated response body (the skill list grows with every skill in the
    // pack) reproducibly triggers a premature socket reset in undici. Let the
    // client negotiate keep-alive normally instead.
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`, { cause: error });
    }
    throw error;
  }
}

export async function stopServer(child, graceMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));

  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }

  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, graceMs)),
  ]);
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, graceMs)),
  ]);
}

function lastToolRule(agent, permission, pattern) {
  return agent.permission
    .filter((rule) => rule.permission === permission && rule.pattern === pattern)
    .at(-1)?.action;
}

function assertSkills(skills) {
  for (const name of expectedSkills) {
    const skill = skills.find((entry) => entry.id === name);
    assert.ok(skill, `skill exists for ${name}; found: ${skills.map((entry) => entry.id).join(", ")}`);
    assert.match(skill.description ?? "", /\S/, `${name} has a description`);
    assert.equal(
      skill.path,
      path.join(repo, "skills", name, "SKILL.md"),
      `${name} resolves to its bundled SKILL.md`,
    );
    assert.doesNotMatch(skill.content, /^---/, `${name} registers its body without frontmatter`);
  }
}

function assertAgents(agents) {
  for (const name of expectedAgents) {
    const agent = agents.find((entry) => entry.id === name);
    assert.ok(agent, `${name} agent exists`);
    assert.equal(agent.mode, "subagent");
    assert.match(agent.system ?? "", /\S/, `${name} has a system prompt`);
  }
}

async function assertEffectivePermissions(url) {
  const post = async (pathname, body) => {
    const response = await fetch(`${url}${pathname}`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(response.ok, `${pathname} returned HTTP ${response.status}`);
    return response.json();
  };
  const { data: session } = await post("/api/session", { title: "Power pack permission smoke" });
  for (const agent of expectedAgents) {
    for (const [action, resource] of [
      ["read", "project/.env"], ["edit", "project/file.js"],
      ["shell", "touch unexpected-file"], ["subagent", "build"],
      ["webfetch", "https://example.com"],
      ["shell", "git diff --output=unexpected-file"],
    ]) {
      const { data } = await post(`/api/session/${session.id}/permission`, {
        agent, action, resources: [resource], save: [],
      });
      assert.equal(data.effect, "deny", `${agent} denies ${action} despite global allow`);
    }
    const { data } = await post(`/api/session/${session.id}/permission`, {
      agent, action: "read", resources: ["project/README.md"], save: [],
    });
    assert.equal(data.effect, "allow", `${agent} can read source files`);
  }
}

function assertLegacyAgents(agents) {
  for (const name of expectedAgents) {
    const agent = agents.find((entry) => entry.name === name);
    assert.ok(agent, `${name} agent exists`);
    assert.equal(agent.mode, "subagent");
    assert.equal(lastToolRule(agent, "read", "*.env"), "deny", `${name} cannot read environment files`);
    assert.equal(lastToolRule(agent, "edit", "*"), "deny", `${name} cannot edit files`);
    assert.match(agent.prompt ?? "", /\S/, `${name} has a prompt`);
  }
  const reviewer = agents.find((entry) => entry.name === "code-reviewer");
  assert.equal(
    lastToolRule(reviewer, "bash", "git *--output*"),
    "deny",
    "code-reviewer cannot write through Git output options",
  );
}

async function main() {
  const home = mkdtempSync(path.join(tmpdir(), "opencode-power-pack-"));
  const project = path.join(home, "project");
  mkdirSync(project);
  const environment = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_STATE_HOME: path.join(home, "state"),
    npm_config_cache: process.env.npm_config_cache || path.join(process.env.HOME || tmpdir(), ".npm"),
  };
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const stderr = [];
  let child;
  let summary;

  try {
    if (legacy) {
      // OpenCode 1 loads the plugin file directly and discovers the bundled
      // skills through config.skills.paths.
      child = spawn(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["-y", `opencode-ai@${version}`, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
        {
          cwd: project,
          env: {
            ...environment,
            OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [pluginEntrypoint] }),
          },
          detached: process.platform !== "win32",
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

      await waitForServer(url, child, stderr, { url: `${url}/global/health`, headers: {} });

      const commands = await fetchJson(`${url}/command`);
      const agents = await fetchJson(`${url}/agent`);
      for (const name of expectedSkills) {
        const command = commands.find((entry) => entry.name === name);
        assert.ok(command, `native command exists for ${name}`);
        assert.equal(command.source, "skill", `${name} command comes from its skill`);
      }
      assertLegacyAgents(agents);
      summary = `OpenCode ${version}: ${expectedSkills.length} skill commands and ${expectedAgents.length} agents verified`;
    } else {
      // Load the actual package directory and inspect final host state. A
      // setup-time verifier would miss the host's later configuration pass.
      child = spawn(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["-y", "-p", `@opencode/cli@${version}`, "opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
        {
          cwd: project,
          env: {
            ...environment,
            OPENCODE_SERVER_PASSWORD: serverPassword,
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              plugins: [repo],
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
            }),
          },
          detached: process.platform !== "win32",
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

      await waitForServer(url, child, stderr, {
        url: `${url}/api/info`,
        headers: { authorization },
      });

      const skills = await waitForEntries(`${url}/api/skill`, expectedSkills, { authorization });
      const agents = await waitForEntries(`${url}/api/agent`, expectedAgents, { authorization });
      assertSkills(skills);
      assertAgents(agents);
      await assertEffectivePermissions(url);
      summary = `OpenCode ${version}: ${expectedSkills.length} skills and ${expectedAgents.length} agents verified, including effective read-only permissions`;
    }

    console.log(summary);
  } catch (error) {
    if (!legacy) {
      try {
        const diagnostics = await fetchJson(`${url}/api/plugin`, 2_000, 0, { authorization });
        console.error(JSON.stringify(diagnostics));
      } catch { /* Preserve the original smoke failure. */ }
    }
    if (stderr.length) console.error(stderr.join(""));
    throw error;
  } finally {
    try {
      if (child) await stopServer(child);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
