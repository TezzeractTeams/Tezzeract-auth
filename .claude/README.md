# Editor / tooling config

`launch.json` defines the dev-server entry used by the preview tooling. It runs
the frontend on port 5180.

The mock API is enabled through `web/.env.local` (gitignored), not here:

```
VITE_USE_MOCKS=true
```

See the repository README, "Running locally".
