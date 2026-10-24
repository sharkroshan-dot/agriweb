# Manual Pickup Route Planning

## Purpose
Farm Collection supports two planning modes:

- **Automatic**: the route planner chooses an efficient farm-stop order while respecting the selected pickup vehicle capacity.
- **Manual**: the warehouse operator chooses the order of selected farm stops explicitly, reviews the route sequence, then creates the route using the existing pickup assignment workflow.

The manual planner is implemented in Farm Collection and uses the existing route creation endpoint. Manual planning must never bypass the server's eligibility, capacity, and duplicate-route checks. It uses the same `POST /api/v1/warehouse/me/pickup-routes` endpoint and adds optional `manualStopOrder` data. The backend validates that the order is an exact permutation of all farm keys produced from the selected collection jobs before persisting anything. If omitted, existing automatic planning stays unchanged.

## Implemented interaction
1. Select one or more farms (or individual eligible jobs using **View orders**).
2. Choose **Manual route order** in the Route Planning Mode control.
3. Review the selected farms in a numbered list. Move a farm earlier/later to change the sequence. Display farm name, pickup address, total orders and expected kg for each stop.
4. Choose the vehicle capacity and assignment method (auto-assign, offer to pickup partners, or one selected team).
5. Select **Create Manual Route & Assign**. The chosen stop order is retained; route/team assignment behavior remains the same as today.

## Safety / validation
- Only `ready_for_pickup` or legacy `team_assigned` collections without `pickupRouteId` can be routed.
- The server rejects stale/duplicate collection IDs.
- Every farm stop's weight must fit the requested vehicle capacity. A manual sequence cannot override capacity.
- The UI warns when a farm has no coordinates: the stop can still be placed manually, but map distance/ETA is unavailable until location data is present.
- Never auto-submit when the stop order changes; require an explicit create/assign action.
- After success, refresh the collection queue and pickup-route list.
