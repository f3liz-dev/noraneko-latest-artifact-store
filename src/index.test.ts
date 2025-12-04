import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/index";

describe("Noraneko Artifact Store", () => {
  it("health check returns ok", async () => {
    const res = await worker.fetch(new Request("http://x/health"), env as Env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("OPTIONS returns CORS headers", async () => {
    const res = await worker.fetch(
      new Request("http://x/upload", { method: "OPTIONS" }),
      env as Env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("upload without auth returns 401", async () => {
    const res = await worker.fetch(
      new Request("http://x/upload?filename=test.zip", { method: "PUT", body: "x" }),
      env as Env
    );
    expect(res.status).toBe(401);
  });

  it("upload with invalid token returns 403", async () => {
    const res = await worker.fetch(
      new Request("http://x/upload?filename=test.zip", {
        method: "PUT",
        headers: { Authorization: "Bearer invalid" },
        body: "x",
      }),
      env as Env
    );
    expect(res.status).toBe(403);
  });

  it("download without filename returns 400", async () => {
    const res = await worker.fetch(new Request("http://x/download"), env as Env);
    expect(res.status).toBe(400);
  });

  it("download non-existent returns 404", async () => {
    const res = await worker.fetch(
      new Request("http://x/download?filename=none.zip"),
      env as Env
    );
    expect(res.status).toBe(404);
  });

  it("download with invalid filename returns 400", async () => {
    const res = await worker.fetch(
      new Request("http://x/download?filename=../etc/passwd"),
      env as Env
    );
    expect(res.status).toBe(400);
  });

  it("list artifacts returns empty array", async () => {
    const res = await worker.fetch(new Request("http://x/artifacts"), env as Env);
    expect(res.status).toBe(200);
    const body = await res.json() as { artifacts: unknown[] };
    expect(body.artifacts).toEqual([]);
  });

  it("unknown path returns 404", async () => {
    const res = await worker.fetch(new Request("http://x/unknown"), env as Env);
    expect(res.status).toBe(404);
  });
});
