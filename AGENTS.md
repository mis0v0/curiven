# Working on CURIVEN

## Repository safety

Work only in the authorized development checkout. Never import private archives, original Git history, learner records, raw AI captures, authorization records, credentials or private evaluation benchmarks. Verify branch, starting SHA and working-tree state before editing. Preserve unrelated work. Stage reviewed files by explicit path. The developer performs pushes and authorizes deployment. Never force push.

## Engineering and review

Prefer the smallest change supported by the evidence. Preserve existing behavior and meaningful regression coverage. Reproduce a defect before calling it confirmed. Report unverified risks separately. Never weaken an assertion to obtain a pass. Use synthetic fixtures, isolated storage and mocked providers for regression tests. Record which suites ran, including failures and skips.

Review authentication, authorization, credential exposure, privacy, data integrity, unsafe file parsing, XSS, CSRF, SSRF and path traversal. Check external API boundaries, resource exhaustion, dependencies and supply-chain risks. Treat model output as untrusted. Look for security regressions and weakened assertions. Give precise file references, realistic impact, supporting evidence and minimal remediation. Never disclose complete secrets or private learner data.

## Product decisions

Preserve learner agency. AI should guide the learner's own reasoning. Describe feedback and evidence truthfully and reserve mastery claims for verified learning. Avoid unnecessary architectural complexity.
