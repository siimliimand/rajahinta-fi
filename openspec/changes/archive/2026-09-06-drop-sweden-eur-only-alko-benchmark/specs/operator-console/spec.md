# operator-console Specification

## MODIFIED Requirements

### Requirement: Operator console for human workflows

The operator console SHALL cover the human workflows that remain after the FX removal: source-governance grants and revocations, tax-dataset version confirmations, and the correction queue. The FX dataset publish flow and its console section SHALL NOT exist. Every remaining console action SHALL stay audited in the append-only audit trail.

#### Scenario: No FX publish surface

- **WHEN** an operator loads the console dataset-confirmation view
- **THEN** only tax-dataset versions are listed for confirmation, and no FX publish endpoint exists in the API surface
