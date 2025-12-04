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
  repository_owner: string;
  ref: string;
  ref_type: string;
  job_workflow_ref: string;
  event_name: string;
  actor: string;
  run_id: string;
  run_number: string;
  run_attempt: string;
}

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS_URI =
  "https://token.actions.githubusercontent.com/.well-known/jwks";

async function verifyGitHubOIDCToken(
  token: string,
  allowedRepository: string
): Promise<GitHubOIDCClaims> {
  const JWKS = jose.createRemoteJWKSet(new URL(GITHUB_JWKS_URI));

  const { payload } = await jose.jwtVerify(token, JWKS, {
    issuer: GITHUB_OIDC_ISSUER,
  });

  const claims = payload as GitHubOIDCClaims;

  if (claims.repository !== allowedRepository) {
    throw new Error(
      `Repository mismatch: expected ${allowedRepository}, got ${claims.repository}`
    );
  }

  return claims;
}

function extractBranchFromRef(ref: string): string {
  if (ref.startsWith("refs/heads/")) {
    return ref.replace("refs/heads/", "");
  }
  if (ref.startsWith("refs/tags/")) {
    return ref.replace("refs/tags/", "");
  }
  return ref;
}

async function handleUpload(
  request: Request,
  env: Env,
  claims: GitHubOIDCClaims
): Promise<Response> {
  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");

  if (!filename) {
    return new Response(JSON.stringify({ error: "Missing filename parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const filenameRegex = /^[a-zA-Z0-9._-]+$/;
  if (!filenameRegex.test(filename)) {
    return new Response(
      JSON.stringify({ error: "Invalid filename format" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const branch = extractBranchFromRef(claims.ref);
  const key = `${branch}/latest/${filename}`;

  const body = request.body;
  if (!body) {
    return new Response(JSON.stringify({ error: "Request body is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const contentType =
    request.headers.get("Content-Type") || "application/octet-stream";

  await env.ARTIFACTS_BUCKET.put(key, body, {
    httpMetadata: {
      contentType: contentType,
    },
    customMetadata: {
      repository: claims.repository,
      branch: branch,
      ref: claims.ref,
      actor: claims.actor,
      run_id: claims.run_id,
      run_number: claims.run_number,
      uploaded_at: new Date().toISOString(),
    },
  });

  return new Response(
    JSON.stringify({
      success: true,
      key: key,
      message: `Artifact uploaded successfully to ${key}`,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

async function handleList(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const branch = url.searchParams.get("branch") || "main";
  const prefix = `${branch}/latest/`;

  const listed = await env.ARTIFACTS_BUCKET.list({ prefix });

  const artifacts = listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
  }));

  return new Response(
    JSON.stringify({
      branch: branch,
      artifacts: artifacts,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

async function handleDownload(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const branch = url.searchParams.get("branch") || "main";
  const filename = url.searchParams.get("filename");

  if (!filename) {
    return new Response(JSON.stringify({ error: "Missing filename parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const filenameRegex = /^[a-zA-Z0-9._-]+$/;
  if (!filenameRegex.test(filename)) {
    return new Response(
      JSON.stringify({ error: "Invalid filename" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const key = `${branch}/latest/${filename}`;
  const object = await env.ARTIFACTS_BUCKET.get(key);

  if (!object) {
    return new Response(JSON.stringify({ error: "Artifact not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType || "application/octet-stream"
  );
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  if (object.customMetadata) {
    headers.set("X-Artifact-Repository", object.customMetadata.repository || "");
    headers.set("X-Artifact-Branch", object.customMetadata.branch || "");
    headers.set("X-Artifact-Uploaded-At", object.customMetadata.uploaded_at || "");
    headers.set("X-Artifact-Run-Id", object.customMetadata.run_id || "");
  }

  return new Response(object.body, {
    headers: headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        },
      });
    }

    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path === "/upload" && request.method === "PUT") {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing or invalid Authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const token = authHeader.slice(7);

      try {
        const claims = await verifyGitHubOIDCToken(token, env.ALLOWED_REPOSITORY);
        return await handleUpload(request, env, claims);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Token verification failed";
        return new Response(JSON.stringify({ error: message }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (path === "/artifacts" && request.method === "GET") {
      return await handleList(request, env);
    }

    if (path === "/download" && request.method === "GET") {
      return await handleDownload(request, env);
    }

    return new Response(
      JSON.stringify({
        error: "Not found",
        endpoints: {
          "PUT /upload?filename=<name>": "Upload artifact (requires GitHub OIDC token)",
          "GET /artifacts?branch=<branch>": "List artifacts for a branch",
          "GET /download?branch=<branch>&filename=<name>": "Download artifact",
          "GET /health": "Health check",
        },
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  },
};
