## ADDED Requirements

### Requirement: Five-layer modular monolith structure

The project SHALL be organized into five bounded layers, each a separate directory or module with a stable interface:
1. Data Acquisition Layer
2. Core Domain / Calculation Layer
3. Data Platform Layer
4. Application / API Layer
5. Presentation Layer

Each layer MUST only depend on layers below it. Circular dependencies between layers SHALL NOT exist.

#### Scenario: Layer separation enforced

- **WHEN** code in the Presentation Layer attempts to import directly from the Data Acquisition Layer (skipping the Application/API Layer)
- **THEN** the build or lint step SHALL fail with a clear layer-violation message

#### Scenario: Module extraction achievable without domain redesign

- **WHEN** a developer extracts the Data Acquisition Layer into a separate service
- **THEN** the Core Domain Layer SHALL NOT require code changes beyond updating the Data Acquisition interface implementation

### Requirement: Strict module interfaces between layers

Every layer boundary SHALL define a stable, documented interface (e.g., a TypeScript interface, an API contract, or a protocol buffer definition). Modules MUST communicate only through these interfaces.

#### Scenario: Interface change detected

- **WHEN** a developer modifies a layer's public interface
- **THEN** the CI/CD pipeline SHALL flag the change and require documentation update before merge

### Requirement: Tech stack selection recorded

The project SHALL document the selected backend language/framework, database, and frontend framework with rationale for each choice.

#### Scenario: Stack decision visible

- **WHEN** a new contributor opens the project
- **THEN** they SHALL find a `docs/tech-stack.md` (or equivalent) listing each component and the reasoning behind its selection

### Requirement: Single codebase entry point

The scaffold SHALL include a single build and run entry point (e.g., one top-level `package.json` or equivalent) that builds and launches the entire modular monolith.

#### Scenario: One-command start

- **WHEN** a developer runs the documented start command
- **THEN** all five layers SHALL compile and the application SHALL be available on a documented local port