---
schema_version: 1
open_count: 0
waived_count: 1
fixed_count: 0
total_count: 1
last_updated: 2026-08-15T19:33:56.149Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | unrun-verify |  |  | 01-01 Task 2: npm run lint / npm test / npm run build could not be run — broken node_modules + registry TLS cert failure in this sandbox; only typecheck + scoped grep sweep verified | waived | User explicitly accepted reduced verification (typecheck+grep only) for Plan 01-01 due to unresolved node_modules/registry TLS environment issue; lint/test/build deferred | 2026-08-15T17:04:21.649Z | 2026-08-15T19:33:56.149Z |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "01",
    "file": "",
    "line": null,
    "description": "01-01 Task 2: npm run lint / npm test / npm run build could not be run — broken node_modules + registry TLS cert failure in this sandbox; only typecheck + scoped grep sweep verified",
    "status": "waived",
    "reason": "User explicitly accepted reduced verification (typecheck+grep only) for Plan 01-01 due to unresolved node_modules/registry TLS environment issue; lint/test/build deferred",
    "recorded_at": "2026-08-15T17:04:21.649Z",
    "resolved_at": "2026-08-15T19:33:56.149Z"
  }
]
````
