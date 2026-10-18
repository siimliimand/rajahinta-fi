# agent-tool-surface Specification

## Purpose
Expose the platform's public catalog and calculator reads as a closed, strictly
read-only MCP tool surface so browser agents (WebMCP via the Cloudflare edge
bridge, or any MCP client) can query authoritative data instead of screen-scraping
— without widening the API boundary past what crawlers can already see.

## Requirements

### Requirement: Closed read-only MCP tool surface

The api-worker SHALL serve an MCP endpoint at `/mcp` whose tool list is exactly
`search_products`, `get_product`, and `calculate_landed_cost` — a closed set,
versioned in code. Every tool SHALL be read-only: no tool may write any table,
mutate any account, send any message, or access any account-scoped or PII surface.
An unknown tool name SHALL be rejected with a contract-level error.

#### Scenario: Tool list is the closed set

- **WHEN** a client lists the server's tools
- **THEN** exactly `search_products`, `get_product`, and
  `calculate_landed_cost` are returned, each described with an input schema

#### Scenario: Unknown tool rejected

- **WHEN** a client calls a tool outside the closed set
- **THEN** the server rejects it with a contract-level error naming the valid
  tools

### Requirement: Age-gate semantics preserved at the tool boundary

The MCP endpoint SHALL enforce the same age-gate contract as the public API. A
caller riding a confirmed session receives tool results; an unconfirmed caller
receives the contract gate error pointing at the gate — never computed figures.
The API boundary remains the enforcement point; the tool layer adds no bypass.

#### Scenario: Unconfirmed caller gets the gate, not data

- **WHEN** an unconfirmed client invokes `calculate_landed_cost`
- **THEN** the response is the age-gate contract error and no cost figures are
  returned

#### Scenario: Confirmed session rides through

- **WHEN** a confirmed session invokes `get_product` from the page context
- **THEN** the tool returns the same public payload shape the product page renders

### Requirement: Public-data-only exposure

Every tool response SHALL be derivable from data already crawler-visible on public
pages (catalog, observed offers, landed-cost computation). Account data, favorites,
alerts, calculation records, and ops surfaces SHALL NOT be reachable through any
tool, directly or via JOIN.

#### Scenario: No account surface reachable

- **WHEN** any tool in the closed set is invoked with arbitrary valid inputs
- **THEN** the response contains only public catalog or calculation data

### Requirement: Rate-limited tool surface

The `/mcp` endpoint SHALL apply the house rate-limiting conventions at the
endpoint boundary, independently of per-tool logic.

#### Scenario: Excessive calls rejected

- **WHEN** a client exceeds the configured rate limit on `/mcp`
- **THEN** further calls are rejected with the house rate-limit error shape until
  the window resets
