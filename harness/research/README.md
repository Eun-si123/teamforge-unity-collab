# Optional read-only web research

Portable Harness exposes two narrowly scoped functions when explicitly
enabled in an operator-owned configuration:

- web_search calls the user's local SearXNG JSON endpoint, returning a bounded
  collection of five HTTPS search results, with source links and truncated
  excerpts. Search snippets are always tagged as untrusted external content.
- web_read calls an independent, isolated Playwright MCP server through a
  local loopback-only HTTP transport. The only invoked MCP tools are browser
  navigation and accessibility snapshot. It never gives the model browser
  clicks, form entry, JavaScript execution, filesystem access or unsafe tools.

Before visiting a site, the adapter enforces exact allowed HTTPS hostnames
and public DNS resolution; after navigation, it verifies the reported
destination before returning page content. Model-visible output is capped.
The adapter uses an exclusive local browser lease and bounded call counts.

Important limitation: a DNS preflight cannot prevent every DNS-rebinding,
cross-origin resource or redirect-to-internal-network scenario. Protect the
dedicated Playwright container with network egress policy and restrict the
allowlist to public documentation sites. Never enable internal/admin sites.

On the mini PC, the dedicated container is teamforge-harness-playwright,
loopback port 33225, backed by the existing Playwright MCP image and the
same sandbox policy as the other browser but without a shared profile.
SearXNG is already hosted on loopback port 8888. Browser requests never
share the persistent playwright-mcp-minipc user session.

Test:

    node --test harness/test/research.test.mjs

Mini-PC-only integration (no model API or GitHub operations):

    HARNESS_WEB_SMOKE=1 node --test --test-isolation=none harness/test/research.test.mjs
