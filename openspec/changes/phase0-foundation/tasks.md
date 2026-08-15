## 1. Project Scaffold

- [ ] 1.1 Select backend language/framework, database, and frontend framework; record decision in `docs/tech-stack.md` <!-- agent: platform-engineer.fast, depends_on: [], touches: [docs/tech-stack.md] -->
- [ ] 1.2 Scaffold the modular monolith with five bounded layers: Data Acquisition, Core Domain, Data Platform, Application/API, Presentation <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [src/**/*] -->
- [ ] 1.3 Establish strict module interfaces between layers so any layer can be extracted without domain redesign <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [src/**/interfaces/*] -->

## 2. Environment Pipeline

- [ ] 2.1 Set up three-tier environment pipeline (development → staging → production) <!-- agent: devops-engineer.build, depends_on: [1.2], touches: [.github/workflows/*, infra/*] -->
- [ ] 2.2 Provision staging copy of tax-rule and merchant data for realistic rule-change review <!-- agent: devops-engineer.build, depends_on: [2.1], touches: [infra/staging-data/*] -->

## 3. CI/CD

- [ ] 3.1 Configure CI/CD with automated regression tests (golden-dataset tax tests, data-quality checks, compliance checks) on every deploy <!-- agent: devops-engineer.build, depends_on: [1.2, 2.1], touches: [.github/workflows/*] -->

## 4. Feature Flags

- [ ] 4.1 Deploy feature-flag system gating new merchant sources, new tax rulesets, and new UI ranking behavior <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [src/**/feature-flags/*] -->

## 5. Background Jobs

- [ ] 5.1 Set up scheduled/queued job infrastructure for background work (price ingestion, transport-rate refresh, tax-dataset review, time-series aggregation), isolated from the request/response path <!-- agent: platform-engineer.build, depends_on: [1.2, 2.1], touches: [src/**/jobs/*, infra/jobs/*] -->

## 6. Observability

- [ ] 6.1 Instrument the four KPI categories (product, commercial, data, compliance) directly, not reconstructed from raw logs <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [src/**/observability/*] -->
- [ ] 6.2 Expose operational health signals (stale-data rate, percentage of verified calculations, compliance incidents) on an internal ops dashboard <!-- agent: platform-engineer.build, depends_on: [6.1], touches: [src/**/observability/*] -->
- [ ] 6.3 Instrument per-calculation cost attribution so infrastructure spend ties to commercial metrics <!-- agent: platform-engineer.build, depends_on: [6.1], touches: [src/**/observability/*] -->