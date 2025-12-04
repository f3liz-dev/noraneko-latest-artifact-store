import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/index";

interface ErrorResponse {
  error: string;
}

interface ArtifactsResponse {
  branch: string;
  artifacts: Array<{ key: string; size: number; uploaded: string }>;
}

interface NotFoundResponse {
  error: string;
  endpoints: Record<string, string>;
}

describe("Noraneko Artifact Store Worker", () => {
  describe("Health endpoint", () => {
    it("returns ok status", async () => {
      const request = new Request("http://example.com/health");
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("OPTIONS request", () => {
    it("returns CORS headers", async () => {
      const request = new Request("http://example.com/upload", {
        method: "OPTIONS",
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, POST, PUT, OPTIONS"
      );
    });
  });

  describe("Upload endpoint", () => {
    it("returns 401 without authorization header", async () => {
      const request = new Request("http://example.com/upload?filename=test.zip", {
        method: "PUT",
        body: "test content",
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toContain("Authorization");
    });

    it("returns 403 with invalid token", async () => {
      const request = new Request("http://example.com/upload", {
        method: "PUT",
        headers: {
          Authorization: "Bearer invalid-token",
        },
        body: "test content",
      });
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(403);
    });

    it("rejects invalid filename characters with invalid token", async () => {
      const request = new Request(
        "http://example.com/upload?filename=../../../etc/passwd",
        {
          method: "PUT",
          headers: {
            Authorization: "Bearer some-token",
          },
          body: "test content",
        }
      );
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(403);
    });
  });

  describe("Download endpoint", () => {
    it("returns 400 without filename parameter", async () => {
      const request = new Request("http://example.com/download?branch=main");
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toContain("filename");
    });

    it("returns 404 for non-existent artifact", async () => {
      const request = new Request(
        "http://example.com/download?branch=main&filename=nonexistent.zip"
      );
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(404);
    });

    it("rejects invalid filename characters", async () => {
      const request = new Request(
        "http://example.com/download?branch=main&filename=../../../etc/passwd"
      );
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorResponse;
      expect(body.error).toContain("Invalid filename");
    });
  });

  describe("List artifacts endpoint", () => {
    it("returns empty list for branch without artifacts", async () => {
      const request = new Request("http://example.com/artifacts?branch=main");
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const body = (await response.json()) as ArtifactsResponse;
      expect(body.branch).toBe("main");
      expect(body.artifacts).toEqual([]);
    });
  });

  describe("404 handler", () => {
    it("returns 404 for unknown paths", async () => {
      const request = new Request("http://example.com/unknown");
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env as Env);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(404);
      const body = (await response.json()) as NotFoundResponse;
      expect(body.error).toBe("Not found");
      expect(body.endpoints).toBeDefined();
    });
  });
});
