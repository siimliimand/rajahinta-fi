# application-api — Delta Spec

## MODIFIED Requirements

### Requirement: Composition root wires real ports

The backend composition root SHALL inject the concrete calculator port implementations (product data, calculation record persistence) and the concrete tax-rule repository through `forRoot` factory functions that register the providers inside the consuming module's scope. No null-port binding SHALL be reachable from the backend application's module graph. Static core-domain modules MAY keep null bindings, and tests MAY override ports, but only through the standard test override mechanism.

#### Scenario: Calculator resolves real adapters in production wiring

- **WHEN** the application module is composed with `ApplicationApiModule.forRoot(...)` and booted
- **THEN** `LandedCostCalculatorService` SHALL hold non-null `PRODUCT_DATA_PORT` and `CALCULATION_RECORD_PORT` implementations, and `AlcoholExciseService` SHALL hold the concrete tax-rule repository adapter

#### Scenario: One calculation completes through the composed app

- **WHEN** a calculation request is executed against the booted real application module with the database boundary faked only at the repository level
- **THEN** the calculation SHALL complete without a null-port error and produce an itemized result

#### Scenario: Configured modules do not duplicate static metadata

- **WHEN** a `forRoot`-configured module is instantiated
- **THEN** it SHALL use a fresh undecorated module identity so the static null-port `@Module` metadata is not merged into the configured dependency graph (no double registration of any module or guard)
