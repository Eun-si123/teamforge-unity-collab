# GitHub repository traffic observations (maintainer note)

This is a small, best-effort process to compare **actual GitHub repository traffic**
with **GitHub Actions execution volume**, so automation-heavy repositories such as
TeamForge are not mistaken for having thousands of independently confirmed users.

## Collection and retention

- [Repository traffic observation](../.github/workflows/repository-traffic.yml) runs **weekly on Monday, 08:17 UTC** (17:17 KST, scheduled runs may be delayed). Maintainers can also trigger `workflow_dispatch` from Actions.
- The collector is [`scripts/repo_traffic_snapshot.py`](../scripts/repo_traffic_snapshot.py). It pulls up to 14 UTC calendar days of GitHub Traffic (clones, views, popular paths and referring sites) and the number of GitHub Actions workflow runs created for each comparable UTC day.
- Each run uploads **`snapshot.json`**, **`daily.csv`**, and **`report.md`** as a *90-day Actions artifact*, named `teamforge-repo-traffic-<run-id>`. Download it from that workflow run's **Artifacts** section. Retention is finite: export the artifacts elsewhere before expiry for a permanent record.
- Run output is only a **time-windowed observation**; it is not automatically published to Git or the website. The workflow does not print view/clone counts into publicly visible logs or summaries. GitHub Actions artifacts on public repositories should **not** be treated as confidential storage: share only aggregated, non-personal repository statistics.
- The collection uses GitHub's UTC day boundaries; today's totals can be incomplete and the service may update metrics with a delay.
- **Calendar alignment:** GitHub Traffic's 14-day API window can end on **yesterday**, not the current UTC day. When traffic is configured, the collector uses the **dates returned by the API** and compares Actions for those exact dates (including a previous date outside the naive today-minus-13-day range). A day missing from a Traffic series remains **blank/unknown**, never a fabricated 0. Without a configured token, the Actions-only fallback covers the latest 14 UTC days.

## One-time setup for clone and visitor statistics

GitHub's Traffic API requires **repository Administration: read** permission for fine-grained tokens. The built-in `GITHUB_TOKEN` cannot simply be given that permission by adding `permissions:` to a workflow. Follow GitHub's [official REST Traffic API permissions](https://docs.github.com/en/rest/metrics/traffic).

1. Open [GitHub fine-grained personal access tokens](https://github.com/settings/personal-access-tokens). Create a token owned by the appropriate account, with repository access limited to **only `teamforge-unity-collab`**, **Administration: Read-only** and an expiration date. Do not grant write permissions.
2. Under [TeamForge → Settings → Secrets and variables → Actions](https://github.com/Eun-si123/teamforge-unity-collab/settings/secrets/actions), add a repository secret named **`TEAMFORGE_TRAFFIC_READ_TOKEN`** containing that token. Never commit or paste it into documentation, screenshots or an Issue.
3. From [Actions → Repository traffic observation](https://github.com/Eun-si123/teamforge-unity-collab/actions/workflows/repository-traffic.yml), select **Run workflow** on `main`. Read the artifact's `snapshot.json`: `trafficStatus` must be `available`.

Without the secret, the job still captures **Actions workflow-run totals** but marks `trafficStatus: not_configured`; blank traffic CSV cells mean *unknown*, not zero. With a token that lacks permission, the job **fails explicitly** instead of fabricating zeroes. When a token expires, rotate it by updating the secret.

## How to interpret the resulting data

- **Clones:** Git full clones, not ordinary `fetch` operations. Repeated downloads, CI checkout, crawler mirrors and bots can contribute.
- **Unique cloners/visitors:** GitHub deduplicates within its reported window; these are **not verified real people**, active installers, or users of the Unity package. Do not add unique daily counts to get a 14-day unique total.
- **Actions runs:** This counts *all workflows created that day*, whether they succeeded, failed, were skipped or are still queued. It does **not** count actual `git clone` operations. The collector itself adds one scheduled run.
- **Coincident spikes:** Many Actions runs and clones on one day are a **hypothesis for automation-related traffic**, not proof of causation; external crawlers or CI agents can act independently of this repository's Actions.
- **Visitor paths/referrers:** GitHub repository web UI only; TeamForge's GitHub Pages website is a separate site. Some referrer information may be absent.
- **How to confirm external impact:** independently documented issue reports, helpful discussions, downstream citations/reuse, and reproducible third-party adoption—not just clone totals or stars.

## Validation boundaries

The collector's no-network unit tests run during the Pages PR validation and inside each snapshot workflow. A green unit test or Actions run without a configured token does **not** verify real Traffic API access. After adding the secret, check one artifact with `trafficStatus: available` to confirm end-to-end permission and collection. The 90-day artifact limit means this is not, on its own, an indefinite analytics warehouse.
