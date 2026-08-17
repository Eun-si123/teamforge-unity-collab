# TeamForge Phase 3 v0.4.1 Closure Rollback

Rollback by switching the entire Project Peer closure set together: `cli.mjs`, `cli-policy.mjs`, `swarm-downloader.mjs`, paired tests/docs. Do not partially remove the no-op Publish policy while leaving operator documentation that assumes it. Never overwrite an existing Active, staging tree, Owner key, or the original Hotfix3 archive. Server/Unity package versions remain 0.4.1 and require no Stage A code rollback because they were not changed.
