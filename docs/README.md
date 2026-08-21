# TeamForge documentation map

Use this page to find the current source of truth before opening historical reports.

## Current project truth

- [Project overview](../README.md)
- [Current status and release-readiness](STATUS.md)
- [Exact release/runtime contract](../release-contract.json)
- [Architecture](architecture.md)
- [Code map](../CODEMAP.md)
- [Source and validation guide](SOURCE.md)
- [Roadmap](ROADMAP.md)
- [Development history](../CHANGELOG.md)
- [Security policy](../.github/SECURITY.md)
- [Contributing](../.github/CONTRIBUTING.md)

## Module guides

- [Unity package](../unity-package/com.eunsung.teamforge/README.md)
- [Realtime server](../server/README.md)
- [Project Peer](../project-peer/README.md)
- [Windows launcher](../launcher/README.md)
- [Repository scripts](../scripts/README.md)

## Historical engineering records

`phases/`, `work-state/`, test reports, hotfix reports, and changed-file notes are retained as project history. They may describe superseded behavior. When they disagree with current source/tests, `STATUS.md`, `release-contract.json`, or current architecture/module documentation, prefer the current material.

## Machine-readable discovery

- [llms.txt](../llms.txt) — curated AI/agent routing
- [AI discovery design](AI_DISCOVERY.md) — search and LLM discovery strategy
- [Repository manifest](https://eun-si123.github.io/teamforge-unity-collab/repository-manifest.json) — exhaustive tracked-file inventory for the deployed source commit
