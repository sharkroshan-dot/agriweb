# AgriConnect UX Design System

## Navigation model

Keep primary navigation limited to the tasks a role performs every day. Move secondary utilities into More/Account rather than adding another top-level destination.

## AI insight pattern

Every AI insight should contain:

- What happened or is predicted
- Confidence/quality of the prediction when available
- Why the system is showing it
- Suggested next action
- User-controlled action button

Example:

Tomato demand is expected to rise over the next 7 days.
Confidence: 87%
Drivers: recent orders, seasonality and local inventory.
[Review forecast] [Dismiss]

## State model

Every async component supports:
idle -> loading -> success | empty | error

Offline-capable screens additionally expose:
cached -> syncing -> synced | sync-error

## Accessibility

- Use semantic HTML and labels.
- Preserve visible focus.
- Do not encode status by color alone.
- Keep interactive targets comfortable on touch devices.
- Respect prefers-reduced-motion.
- Maintain readable contrast in light and dark themes.

## Responsive priorities

### Mobile
Primary action, current task, status and location first.

### Tablet
Two-column task layouts where useful.

### Desktop
Dashboards, maps, analytics and operational tables can use denser layouts.

## AI safety

AI must never silently:

- ban a customer
- change a farmer's price
- cancel an order
- reject a payment
- assign a delivery outside eligibility rules

Instead, expose the recommendation and let business rules and the user/authorized operator determine the action.
