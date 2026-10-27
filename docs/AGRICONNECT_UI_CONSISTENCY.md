# AgriConnect UI consistency pass

This branch introduces reusable UI patterns for the Next.js website across Customer, Farmer, Delivery Partner, Warehouse, Business, and Admin.

## Shared page pattern
1. A clear page title, one-sentence purpose, and one primary action.
2. Three or four useful metrics only when they help the task.
3. Search and filters immediately above the results.
4. Readable panels with consistent spacing and restrained borders/shadows.
5. Selected records in a separate summary section, with confirmation at the end.
6. Explicit loading, error, empty, success, and disabled states.
7. Responsive forms and horizontally scrollable wide tables on small screens.

## UI principles by role
- **Customer:** prioritize product discovery, cart, order history and delivery status; do not show staff operations.
- **Farmer:** make harvest, inventory, orders, packing and delivery planning legible as related tasks. Filters must not implicitly select or assign orders.
- **Delivery Partner:** present eligible jobs, pickup details, route, drop-off and delivery proof in operational order.
- **Warehouse:** separate transfer tracking, physical receipt, quality review, storage, consolidation and dispatch.
- **Business:** prioritize suppliers, RFQs, offers, purchase orders, contracts and consolidated delivery tracking.
- **Admin:** surface actionable queues, exceptions, role/user controls and auditable operations.

## Data integrity and interaction
- Visual state must match persisted backend state, not just local component state.
- Do not enable dispatch or consolidation before required upstream checks pass.
- Keep order ID and source-portion ID visible in transfer and consolidation details.
- Never equate expected, received, approved, stored and delivered quantities without reconciliation.
- Show status text as well as color; preserve keyboard focus and accessible labels.
- Use a distinct confirmation action for any operation that changes assignment or fulfillment state.

## Reusable CSS classes
The shared classes are appended to `website/app/globals.css`: `ag-page`, `ag-page-header`, `ag-page-title`, `ag-page-description`, `ag-primary-action`, `ag-secondary-action`, `ag-panel`, `ag-panel-title`, `ag-kpi-grid`, `ag-kpi`, `ag-toolbar`, `ag-filter-row`, `ag-form-grid`, `ag-field`, `ag-label`, `ag-input`, `ag-table-wrap`, `ag-table`, `ag-status-*`, `ag-empty-state`, `ag-workflow-steps` and `ag-sticky-actions`.

Apply these classes incrementally to route pages; avoid rewriting API contracts, authorization, or workflow transitions as part of a visual cleanup. Verify each page at desktop and mobile widths before moving to the next role.

## Important limitation
This commit provides the shared design foundation and rollout rules. It does not by itself redesign every individual route. Full-project completion requires applying and visually verifying the classes across each role's actual pages while preserving the existing workflows.
