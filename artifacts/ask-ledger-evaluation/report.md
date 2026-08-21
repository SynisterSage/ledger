# Ask Ledger evaluation report

Generated: 2026-08-21T13:20:13.217Z

This CI-safe report evaluates the canonical fixture through routing, retrieval, graph/orchestration, and evidence compilation. It does not claim live Qwen answer quality; use the optional live tier run for that.

## Overall

- Cases: 32
- Deterministic pipeline pass rate: 87.5% (28/32)
- Average total fixture latency: 24.56 ms
- Average selected evidence: 7.1 resources / 669 estimated tokens

## By category

| Category | Cases | Passed | Pass rate |
| --- | ---: | ---: | ---: |
| simple_facts | 4 | 3 | 75.0% |
| resource_understanding | 4 | 4 | 100.0% |
| meeting_intelligence | 4 | 2 | 50.0% |
| cross_resource_research | 4 | 4 | 100.0% |
| task_intelligence | 5 | 5 | 100.0% |
| attention | 3 | 3 | 100.0% |
| integration_context | 4 | 3 | 75.0% |
| missing_uncertain_evidence | 4 | 4 | 100.0% |

## Failure categories

| Failure | Cases |
| --- | ---: |
| missing_relationship_context | 3 |
| wrong_seed | 2 |

## Worst cases

| Case | Category | Failures |
| --- | --- | --- |
| fact-milestone | simple_facts | wrong_seed, missing_relationship_context |
| meeting-decisions | meeting_intelligence | missing_relationship_context |
| meeting-followups | meeting_intelligence | missing_relationship_context |
| integration-slack | integration_context | wrong_seed |

## Thresholds

- simple_facts: 75.0% actual vs 95.0% threshold — fail
- resource_understanding: 100.0% actual vs 75.0% threshold — pass
- meeting_intelligence: 50.0% actual vs 75.0% threshold — fail
- cross_resource_research: 100.0% actual vs 70.0% threshold — pass
- task_intelligence: 100.0% actual vs 85.0% threshold — pass
- attention: 100.0% actual vs 75.0% threshold — pass
- integration_context: 75.0% actual vs 75.0% threshold — pass
- missing_uncertain_evidence: 100.0% actual vs 85.0% threshold — pass

## Live model comparison

Not run by the CI-safe command. Run the evaluation script with `--live` when the installed fast, balanced, and powerful model tiers are available.
