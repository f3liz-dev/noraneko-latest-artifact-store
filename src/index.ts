/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as jose from "jose";

export interface Env {
  ARTIFACTS_BUCKET: R2Bucket;
  ALLOWED_REPOSITORY: string;
}

interface GitHubOIDCClaims extends jose.JWTPayload {
  repository: string;
  ref: string;
  actor: string;
  run_id: string;
  run_number: string;
}

const GITHUB_JWKS = jose.createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks")
);

const json = (data: object, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const VALID_FILENAME = /^[a-zA-Z0-9._-]+$/;

async function verifyToken(token: string, allowedRepo: string): Promise<GitHubOIDCClaims> {
  const { payload } = await jose.jwtVerify(token, GITHUB_JWKS, {
    issuer: "https://token.actions.githubusercontent.com",
  });
  const claims = payload as GitHubOIDCClaims;
  if (claims.repository !== allowedRepo) {
    throw new Error(`Unauthorized repository: ${claims.repository}`);
  }
  return claims;
}

function getBranch(ref: string): string {
  return ref.replace(/^refs\/(heads|tags)\//, "");
}

async function handleUpload(req: Request, env: Env, claims: GitHubOIDCClaims): Promise<Response> {
  const filename = new URL(req.url).searchParams.get("filename");
  if (!filename || !VALID_FILENAME.test(filename)) {
    return json({ error: "Invalid or missing filename" }, 400);
  }
  if (!req.body) {
    return json({ error: "Request body required" }, 400);
  }

  const branch = getBranch(claims.ref);
  const key = `${branch}/latest/${filename}`;

  await env.ARTIFACTS_BUCKET.put(key, req.body, {
    httpMetadata: { contentType: req.headers.get("Content-Type") || "application/octet-stream" },
    customMetadata: {
      repository: claims.repository,
      branch,
      actor: claims.actor || "unknown",
      run_id: claims.run_id || "unknown",
      uploaded_at: new Date().toISOString(),
    },
  });

  return json({ success: true, key });
}

async function handleList(req: Request, env: Env): Promise<Response> {
  const branch = new URL(req.url).searchParams.get("branch") || "main";
  const { objects } = await env.ARTIFACTS_BUCKET.list({ prefix: `${branch}/latest/` });
  return json({
    branch,
    artifacts: objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() })),
  });
}

async function handleDownload(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const branch = url.searchParams.get("branch") || "main";
  const filename = url.searchParams.get("filename");

  if (!filename || !VALID_FILENAME.test(filename)) {
    return json({ error: "Invalid or missing filename" }, 400);
  }

  const object = await env.ARTIFACTS_BUCKET.get(`${branch}/latest/${filename}`);
  if (!object) {
    return json({ error: "Not found" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        },
      });
    }

    if (pathname === "/health") return json({ status: "ok" });
    if (pathname === "/artifacts" && req.method === "GET") return handleList(req, env);
    if (pathname === "/download" && req.method === "GET") return handleDownload(req, env);

    if (pathname === "/upload" && req.method === "PUT") {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) {
        return json({ error: "Missing authorization" }, 401);
      }
      try {
        const claims = await verifyToken(auth.slice(7), env.ALLOWED_REPOSITORY);
        return handleUpload(req, env, claims);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Auth failed" }, 403);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};
