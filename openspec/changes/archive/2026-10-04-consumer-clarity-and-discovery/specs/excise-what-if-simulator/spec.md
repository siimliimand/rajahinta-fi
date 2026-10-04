# excise-what-if-simulator Delta

## MODIFIED Requirements

### Requirement: Structural HYPOTHETICAL disclaimer

Every what-if result SHALL carry a structural disclaimer field stating the output is a hypothetical scenario, not a forecast, estimate of future prices, or official statement. The disclaimer SHALL be part of the result object and the UI SHALL render it prominently, with wording stronger than the standard calculator disclaimer and free of forecast or political language. The disclaimer SHALL be selected from the versioned FI/EN constant pair by an explicit scenario-input language (`'fi' | 'en'`, defaulting to `'fi'` when absent); the wording of each language variant SHALL NOT be composed at request time. The disclaimer SHALL travel on every 200 response regardless of the requested language. The site client SHALL derive the language from the active `[locale]` path segment and SHALL transmit the `language` request field only when it is not the default locale — an absent field is the domestic signal, resolved by the route's `'fi'` default. The embed recompute SHALL derive the language from its own locale segment, so the share token remains an envelope of scenario inputs only.

#### Scenario: Disclaimer travels with the result

- **WHEN** a what-if result is rendered or shared
- **THEN** the HYPOTHETICAL disclaimer SHALL be present in the payload and visible in the rendering

#### Scenario: Finnish request returns the Finnish disclaimer

- **WHEN** a scenario is submitted with `language: 'fi'`
- **THEN** the result carries the structural disclaimer with `language: 'fi'` and the versioned Finnish wording

#### Scenario: Absent language defaults to Finnish

- **WHEN** a scenario is submitted without a `language` field
- **THEN** the result carries the structural disclaimer with `language: 'fi'`

#### Scenario: English request returns the English disclaimer

- **WHEN** a scenario is submitted with `language: 'en'`
- **THEN** the result carries the structural disclaimer with `language: 'en'` and the versioned English wording

#### Scenario: Client transmits the language only when non-default

- **WHEN** the what-if client submits a scenario from the `en` locale
- **THEN** the request body carries `language: 'en'`
- **AND** from the default Finnish locale the request body omits the field, the route's `'fi'` default applies, and the share token is untouched

#### Scenario: Embed derives language from its locale

- **WHEN** the embed route recomputes a shared scenario under the `en` locale
- **THEN** the rendered result carries the English disclaimer and the share token decoding is unchanged
