/**
 * Shared types for the farmer Order Map / delivery assignment feature.
 *
 * These mirror the payloads produced by the backend
 * (GET /farmers/me/delivery-map and related endpoints) so the map, route,
 * calendar and smart-route pages agree on the order shape.
 */

export type DeliveryState =
  | "pending_assignment" // yellow — no delivery method chosen yet
  | "self_delivery" // green — claimed by the farmer
  | "partner_assignment_pending" // yellow — flagged for a partner
  | "partner_assigned" // blue — handed to a delivery partner
  | "problem" // red — needs attention
  | "delivered"; // black — completed

export interface DeliveryMapOrder {
  id: string;
  orderId: string;
  orderNumber: string;
  buyerName: string;
  customerName: string;
  customerPhone?: string;
  location: string;
  address: string;
  city?: string;
  lat: number | null;
  lng: number | null;
  quantity: string;
  quantityKg: number;
  product?: string;
  items: Array<{ name: string; quantity: number }>;
  status: string;
  time: string;
  deliveryDay?: string;
  deliveryTimeSlot: string;
  timeWindow: string;
  deliveryType: "delivery" | "pickup";
  isPickup: boolean;
  distance: number | null;
  inRadius: boolean;
  total: number;
  paymentMethod: string;
  isCOD: boolean;
  priority: number;
  selfDelivery: boolean;
  deliveryPartnerId?: string | null;
  deliveryPartnerName?: string;
  assignment: "self" | "partner" | "unassigned";
  deliveryState: DeliveryState;
  deliveryProblem: boolean;
  canComplete: boolean;
  deliveredAt?: string;
  isDelivered: boolean;
}

export interface DeliveryMapSummary {
  radius: number;
  totalOrders: number;
  withinRadius: number;
  outsideRadius: number;
  unlocated: number;
  selfDelivery: number;
  partnerAssigned: number;
  unassigned: number;
  delivered: number;
  deliveredWindow: string;
  codCollection: number;
  onlineOrders: number;
  totalValue: number;
  withinValue: number;
  outsideValue: number;
  totalWeight: number;
  withinWeight: number;
  outsideWeight: number;
  estimatedDistance: number;
  withinDistance: number;
  outsideDistance: number;
  deliveryProblem: number;
}

export interface DeliveryPartner {
  id: string;
  name: string;
  phone?: string;
  userId?: string;
  rating: number;
  vehicleType?: string;
  vehicleNumber?: string;
  capacity?: number | null;
  activeLoad: number;
  distanceKm: number | null;
  isAvailable: boolean;
  status: string;
  isVerified: boolean;
}

export interface FarmOrigin {
  name: string;
  lat: number | null;
  lng: number | null;
  address: string;
}

export interface DeliveryMapResponse {
  farm: FarmOrigin;
  radius: number;
  summary: DeliveryMapSummary;
  withinRadius: DeliveryMapOrder[];
  outsideRadius: DeliveryMapOrder[];
  unlocated: DeliveryMapOrder[];
  delivered: DeliveryMapOrder[];
  partners: DeliveryPartner[];
}

/** Result of a bulk accept / assign operation. */
export interface BulkAssignmentResult {
  radius: number;
  claimed?: number;
  alreadySelf?: number;
  assigned?: number;
  targets?: number;
  skipped?: number;
  results?: Array<{ orderId: string; partnerId: string; partnerName: string; status: string; reason?: string }>;
  mode?: "manual" | "ai";
}
