# TeamForge Community & Support

TeamForge is still an early project, so the community structure is intentionally kept simple.

## Where should I post?

### 🐛 Bugs and reproducible problems

Use **GitHub Issues** and choose the bug-report form.

A useful report includes what you were trying to do, reproduction steps, expected behavior, actual behavior, relevant logs or screenshots with secrets removed, and the exact TeamForge/Unity environment that was tested.

When a problem occurs in the Windows Guest Launcher, **Save support bundle…** can create a local, bounded ZIP with default redaction. The bundle is not uploaded automatically and deliberately excludes raw local paths, raw endpoint addresses, access credentials, private keys, environment-variable dumps, Collaboration Invite contents, Project files, arbitrary process dumps, and unbounded logs. Review its `manifest.json` before sharing if your environment has additional privacy requirements. The ordinary **Copy diagnostics** action remains available for a smaller text summary.

For a source checkout, include the Git commit when practical. For a packaged candidate, include the **product version, release ID, exact artifact filename, and SHA-256** when available. Product version alone does not prove that two reports used the same packaged bytes. See [`../release-contract.json`](../release-contract.json) for the source-controlled candidate contract and [`../builds/README.md`](../builds/README.md) for packaged-artifact identity rules.

### 🧪 Test results

Use the **Testing report** issue form for results from trying TeamForge — successful tests are useful too.

Please include the Unity Editor version, operating system/environment, what you tried, what actually happened, and the TeamForge identity described above. Use disposable or backed-up projects during experimental testing.

A PASS applies to the exact source snapshot or packaged artifact that was actually exercised. Do not silently carry a result from an older candidate forward just because both builds use the same product version.

For source-development validation, [Test Lab](../docs/TEST_LAB.md) provides named scenarios and makes external/manual evidence boundaries explicit. A Test Lab `INCOMPLETE` result is not a failure, but it is also not a PASS for the missing Unity/release/field lane.

### 💡 Ideas, questions, and project direction

Use **[GitHub Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions)** for open-ended community conversation.

Discussions are a better fit than Issues for questions, brainstorming, workflow ideas, feature conversations, polls, and general project feedback that is not yet a specific reproducible bug or implementation task.

If you have a concrete feature proposal, the **Feature request** issue form is also available.

### 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Testing, bug reproduction, Unity/C# review, networking review, security review, documentation, UX feedback, translations, and code contributions are welcome.

**AI-assisted contributions are welcome.** Contributors may use AI tools as part of development, review, testing, debugging, documentation, or other work. The contributor remains responsible for reviewing and testing what they submit.

Please also follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) when participating in TeamForge community spaces.

### 🔐 Security vulnerabilities

Read [SECURITY.md](SECURITY.md) before publishing potentially exploitable details.

Please do not post credentials, access tokens, private invite data, private user data, or working exploit details in a public issue when doing so could put users at risk.

## Discord

There is **no official TeamForge Discord server yet**.

A Discord server may be created later if there are enough active testers and contributors for real-time chat to be useful. GitHub should remain the durable source of truth for code changes, bug reports, decisions, security guidance, and project history even if a Discord community is added later.

If an official Discord is created, its link will be added to this repository. Do not assume an independently created server is official unless it is linked from the TeamForge repository.

## Community expectations

Questions, mistakes, negative test results, disagreement, and criticism of the software are welcome.

Please keep discussion focused on the project and treat other contributors respectfully. Technical disagreement is useful; personal attacks are not. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the project-wide community standards.
