# noraneko-latest-artifact-store

A Cloudflare Worker for storing the latest noraneko browser build artifacts with GitHub OIDC authentication.

## Features

- **GitHub OIDC Authentication**: Validates GitHub Actions OIDC tokens for secure uploads
- **Repository Restriction**: Only accepts uploads from `f3liz-dev/noraneko-runtime`
- **R2 Storage**: Uses Cloudflare R2 for artifact storage
- **Latest-only Storage**: Stores only the latest version of each artifact per branch
- **Branch-based Organization**: Artifacts are organized by branch (e.g., `main/latest/filename.zip`)

## API Endpoints

### Upload Artifact (Authenticated)

```
PUT /upload?filename=<artifact-name>
Authorization: Bearer <GitHub-OIDC-Token>
Content-Type: application/octet-stream

<binary-data>
```

### List Artifacts

```
GET /artifacts?branch=<branch-name>
```

### Download Artifact

```
GET /download?branch=<branch-name>&filename=<artifact-name>
```

### Health Check

```
GET /health
```

## GitHub Actions Usage

To upload artifacts from GitHub Actions, use the reusable workflow:

```yaml
name: Build and Upload

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: |
          # Your build steps here
          # Creates artifact.zip

  upload:
    needs: build
    uses: f3liz-dev/noraneko-latest-artifact-store/.github/workflows/upload-artifact.yml@main
    with:
      artifact-name: "artifact.zip"
      artifact-path: "./artifact.zip"
      worker-url: "https://your-worker.your-subdomain.workers.dev"
```

## Development

### Prerequisites

- Node.js 18+
- Wrangler CLI
- Cloudflare account with R2 enabled

### Setup

```bash
npm install
```

### Run locally

```bash
npm run dev
```

### Run tests

```bash
npm test
```

### Deploy

```bash
npm run deploy
```

## Configuration

The worker expects the following environment variables:

- `ALLOWED_REPOSITORY`: The GitHub repository allowed to upload (default: `f3liz-dev/noraneko-runtime`)
- `ARTIFACTS_BUCKET`: R2 bucket binding for artifact storage

## Security

- JWT tokens are verified against GitHub's OIDC issuer
- Repository claims are validated to prevent unauthorized uploads
- Only the specified repository can upload artifacts

## License

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/