import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson, stopServer, waitForEntries } from "../scripts/opencode-smoke.mjs";

test("catalog readiness waits for final plugin entries after an empty startup response", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: requests === 1 ? [] : [{ id: "skill-a" }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const result = await waitForEntries(`http://127.0.0.1:${server.address().port}`, ["skill-a"], {}, 1_000);
    assert.deepEqual(result, [{ id: "skill-a" }]);
    assert.equal(requests, 2);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("catalog readiness retries a transient startup socket closure", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    if (requests === 1) return request.socket.destroy();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "skill-a" }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const result = await waitForEntries(`http://127.0.0.1:${server.address().port}`, ["skill-a"], {}, 2_000);
    assert.deepEqual(result, [{ id: "skill-a" }]);
    assert.equal(requests, 2);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("fetchJson aborts a stalled OpenCode response", async () => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    await assert.rejects(fetchJson(`http://127.0.0.1:${port}/agent`, 50), /timed out/i);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("stopServer tolerates a child that already exited by signal", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
  });

  if (process.platform === "win32") child.kill("SIGKILL");
  else process.kill(-child.pid, "SIGKILL");
  await once(child, "exit");

  await stopServer(child, 50);
  assert.notEqual(child.signalCode, null);
});
