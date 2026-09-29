import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const ROLE_PROTECTED_PREFIXES: Record<string, string> = {
  "/admin": "admin",
  "/farmer": "farmer",
  "/customer": "customer",
  "/delivery": "delivery",
  "/warehouse": "warehouse",
  "/business": "business",
};

// Route-group pages under (customer) intentionally have short public-looking
// URLs such as /orders and /harvests.  They are still customer-only pages.
// Keep genuinely public marketplace/discovery routes outside this list.
const CUSTOMER_ONLY_PREFIXES = [
  "/cart", "/checkout", "/orders", "/profile", "/reviews", "/wallet",
  "/refunds", "/subscriptions", "/agripoints", "/alerts", "/pickups",
  "/my-deliveries", "/delivery-slots", "/bulk-orders", "/coupons",
  "/wishlist", "/harvests", "/payments",
];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const { pathname } = req.nextUrl;

    const requiredRole =
      Object.entries(ROLE_PROTECTED_PREFIXES).find(([prefix]) => matches(pathname, prefix))?.[1]
      || (CUSTOMER_ONLY_PREFIXES.some((prefix) => matches(pathname, prefix)) ? "customer" : undefined);

    if (requiredRole && token?.role !== requiredRole) {
      const destination = req.nextUrl.clone();
      const role = typeof token?.role === "string" ? token.role : "";
      destination.pathname = role ? `/${role}/dashboard` : "/login";
      destination.search = "";
      return NextResponse.redirect(destination);
    }

    return NextResponse.next();
  },
  {
    pages: { signIn: "/login" },
    callbacks: {
      authorized({ token, req }) {
        const { pathname } = req.nextUrl;
        const publicPaths = [
          "/", "/login", "/register", "/search", "/product", "/categories",
          "/roadmap", "/api", "/_next", "/images", "/marketplace", "/nearby", "/trace",
        ];
        if (publicPaths.some((p) => matches(pathname, p))) return true;
        return !!token;
      },
    },
  },
);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
