# AgriConnect Complete Page & Process Audit

Branch: `feature/agriconnect-complete-enhancement`

## Objective
Every page must be part of a verified business workflow, not only render a UI.

## Global page contract
Every data-driven page should handle:
- loading/skeleton
- success
- empty data
- API/network error with retry
- unauthorized/forbidden
- validation errors
- success feedback
- responsive/mobile layout
- keyboard/focus accessibility
- browser/app back navigation
- stale data/refetch
- destructive-action confirmation
- role authorization

## Customer E2E
Register -> Verify -> Login -> Marketplace -> Search/Filter -> Product -> Cart -> Checkout -> Address -> Delivery method/slot -> Coupon -> Payment -> Order confirmation -> Tracking -> Delivery/OTP/QR -> Delivered -> Review/Rating -> Reorder.

### Customer pages to audit
- dashboard
- marketplace/state marketplace/national marketplace
- nearby
- product detail
- cart
- checkout
- orders/order detail
- delivery slots
- pickups/my deliveries
- subscriptions/farm baskets
- bulk orders
- coupons
- payments/refunds
- wallet/AgriPoints
- reviews
- traceability
- profile
- notifications
- AI assistant

## Farmer E2E
Login -> Dashboard -> Product creation -> Inventory -> Harvest -> Quality -> Batch -> Marketplace -> Customer order -> Preparation -> Pickup/delivery -> Settlement -> Analytics.

### Farmer AI
Demand forecast, price prediction, yield prediction, harvest planning, crop recommendation and anomaly detection must display:
- source period
- prediction
- confidence/metric when available
- explanation/factors
- recommended action
- link/action to the relevant page

## Delivery E2E
Assigned order -> risk evaluation -> accept/reassign -> route -> pickup QR -> navigation -> status updates -> OTP/POD -> delivered -> earnings/rating.

Never fabricate map coordinates. Missing coordinates must show a clear unavailable state.

## Warehouse E2E
Incoming -> quality inspection -> accept/reject -> batch -> storage/cold storage -> stock -> transfer -> outgoing.

Inventory states should remain distinct: available, reserved, damaged, expired, quarantined, transferred.

## Business E2E
RFQ -> farmer offers -> offer comparison -> acceptance -> B2B order -> delivery -> invoice/payment -> history.

## Admin E2E
Users/farmers -> products -> orders -> payments/refunds -> operational analytics -> AI/model monitoring -> audit logs.

## Payment lifecycle
Payment creation -> gateway -> verification -> order/payment state update -> ledger -> settlement/refund.
Order status and payment status must remain independent.

## Traceability
Farm -> crop -> harvest -> quality -> batch -> warehouse -> order -> delivery -> customer.
QR/lot lookup must show only authorized/public traceability data.

## AI Assistant contract
Natural language -> scratch AgriConnect LLM -> structured intent -> authorization -> backend tool -> live data -> response -> UI action.

The LLM must never directly access MongoDB or bypass backend authorization.
Product requests must resolve to live product IDs before a buy/view action.
Private user data requires authenticated backend authorization.

## Notification contract
Business event -> in-app notification -> optional push/email/SMS -> related route/action.
Notifications should contain a safe related entity/action rather than exposing private data.

## Mobile parity
Critical customer, farmer and delivery flows must support:
- mobile navigation stack
- camera/QR
- GPS where required
- offline/error state
- retry
- compact actions
- push notifications

## Recommended implementation order
1. Authentication/authorization
2. Customer purchase lifecycle
3. Farmer lifecycle
4. Delivery lifecycle
5. Warehouse/quality/traceability
6. Business/RFQ
7. Payment/refund/wallet
8. Admin/observability
9. AI actionability/security
10. Mobile parity
11. Accessibility/performance
12. End-to-end regression

## Current ML integration
The current trained pipeline has separate price, demand, delivery-risk and anomaly models. Model outputs should be presented with metrics/confidence where available and should never be represented as guaranteed outcomes.

## Definition of done
A page is complete only when its UI, API, database state, authorization, validation, error/empty/loading states, navigation, notifications and downstream workflow are verified.
