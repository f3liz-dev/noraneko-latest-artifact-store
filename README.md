# noraneko-latest-artifact-store

Cloudflare Worker for storing noraneko browser build artifacts with GitHub OIDC authentication.

## Features

- GitHub OIDC token validation
- Repository restriction (`f3liz-dev/noraneko-runtime` only)
- R2 storage with latest-only per branch
- File and folder upload support

## GitHub Action Usage

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: # build steps...
      
      - uses: f3liz-dev/noraneko-latest-artifact-store/action@main
        with:
          path: ./dist              # file or folder
          worker-url: https://your-worker.workers.dev
          prefix: "build-"          # optional filename prefix
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/upload?filename=<name>` | PUT | Upload (requires OIDC token) |
| `/artifacts?branch=<branch>` | GET | List artifacts |
| `/download?branch=<branch>&filename=<name>` | GET | Download |
| `/health` | GET | Health check |

## Development

```bash
npm install
npm test
npm run dev
npm run deploy
```

## License

MPL-2.0
