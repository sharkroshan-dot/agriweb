# AgriConnect repository guidance

## Product and architecture
- AgriConnect is a multi-role agricultural marketplace and fulfilment platform.
- The six web roles are Customer, Farmer, Business, Warehouse, Delivery Partner and Admin.
- Preserve the existing Next.js, FastAPI, MongoDB and Flutter architecture.
- Reuse the existing role layouts, sidebars, navigation, UI primitives, query clients and API client.
- Do not consolidate separate role workflows into a generic page.

## UX and visual design
- Build an original AgriConnect design identity. Use Amazon and Flipkart only as references for customer-commerce usability (search, discovery, filters, product details, trust, cart and order tracking). Do not copy their branding, layout, logos or assets.
- Use a consistent design language across roles: readable typography, predictable spacing, restrained shadows, clear hierarchy, accessible contrast and responsive content widths.
- Each role must retain a task-specific information architecture and actions.
- Use semantic success, warning, error and informational colours. Never neutralize status borders or status text with broad CSS selectors.
- Provide useful loading, empty, error and success states. Do not replace unavailable API data with invented values.
- Make tables and dense data layouts usable on narrow screens without clipping the page.
- Prefer reusable components and scoped CSS over global one-off overrides.
- Keep keyboard focus visible and use accessible labels, button types and aria attributes.

## Functional safety
- UI-only changes must not alter API contracts, database schemas, permissions, authentication, pricing, order statuses, workflow transitions, routing rules or capacity validation.
- Preserve role-specific business rules. In particular, B2B warehouse routing remains district-based and does not include a Local Hub stage.
- Do not hide failed API states by displaying misleading success or empty data.
- Do not remove existing features or replace real data with mock data.

## Development workflow
- Inspect the current branch, working tree and diff before changes.
- Preserve user changes. Never use destructive reset/clean commands.
- Run relevant lint, type and build checks after implementation.
- Use existing Cypress/Jest tooling where appropriate; do not claim browser verification unless an actual browser run and screenshot inspection occurred.
- Review the final diff and report exact files, commits, test results and limitations.
- Keep work on the current feature branch unless explicitly instructed otherwise.
- Do not merge into main or deploy without explicit instruction.

## Website commands
- From website/: `npm run lint`
- From website/: `npm run build`
- From website/: `npm test -- --runInBand`
