# Ask Ledger evaluation report

Generated: 2026-09-14T00:51:34.835Z

This CI-safe report evaluates the canonical fixture through routing, retrieval, graph/orchestration, and evidence compilation. It does not claim live Qwen answer quality; use the optional live tier run for that.

## Overall

- Cases: 33
- Deterministic pipeline pass rate: 54.5% (18/33)
- Average total fixture latency: 22.78 ms
- Average selected evidence: 6.4 resources / 603 estimated tokens

## By category

| Category | Cases | Passed | Pass rate |
| --- | ---: | ---: | ---: |
| simple_facts | 4 | 2 | 50.0% |
| resource_understanding | 4 | 0 | 0.0% |
| meeting_intelligence | 4 | 3 | 75.0% |
| cross_resource_research | 5 | 2 | 40.0% |
| task_intelligence | 5 | 2 | 40.0% |
| attention | 3 | 3 | 100.0% |
| integration_context | 4 | 2 | 50.0% |
| missing_uncertain_evidence | 4 | 4 | 100.0% |

## Failure categories

| Failure | Cases |
| --- | ---: |
| forbidden_resource_context | 11 |
| wrong_seed | 3 |
| missing_relationship_context | 2 |

## Worst cases

| Case | Category | Failures |
| --- | --- | --- |
| fact-due | simple_facts | forbidden_resource_context |
| fact-milestone | simple_facts | wrong_seed, missing_relationship_context |
| project-alfa | resource_understanding | forbidden_resource_context |
| project-watercolor | resource_understanding | forbidden_resource_context |
| project-next | resource_understanding | wrong_seed |

## Thresholds

- simple_facts: 50.0% actual vs 95.0% threshold — fail
- resource_understanding: 0.0% actual vs 75.0% threshold — fail
- meeting_intelligence: 75.0% actual vs 75.0% threshold — pass
- cross_resource_research: 40.0% actual vs 70.0% threshold — fail
- task_intelligence: 40.0% actual vs 85.0% threshold — fail
- attention: 100.0% actual vs 75.0% threshold — pass
- integration_context: 50.0% actual vs 75.0% threshold — fail
- missing_uncertain_evidence: 100.0% actual vs 85.0% threshold — pass

## Live model comparison

Not run by the CI-safe command. Run the evaluation script with `--live` when the installed fast, balanced, and powerful model tiers are available.
