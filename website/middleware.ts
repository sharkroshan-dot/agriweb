import { withAuth } from "next-auth/middleware";

type AppRole = "customer" | "farmer" | "warehouse" | "delivery" | "admin" | "business";

const ROLE_PREFIXES: Record<AppRole, string[]> = {
  customer: ["/orders", "/cart", "/checkout", "/payments", "/profile", "/reviews", "/my-deliveries", "/delivery-slots", "/harvests", "/bulk", "/coupons", "/refunds", "/chat"],
  farmer: ["/farmer"],
  delivery: ["/delivery"],
  warehouse: ["/warehouse"],
  admin: ["/admin"],
  business: ["/business"],
};

export default withAuth({
  pages: { signIn: "/login" },
  callbacks: {
    authorized({ token, req }) {
      const { pathname } = req.nextUrl;
      const publicPaths = ["/", "/login", "/register", "/search", "/product", "/categories", "/roadmap", "/marketplace", "/nearby", "/trace"];
      if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
      if (!token) return false;
      const role = String(token.role || "").toLowerCase() as AppRole;
      for (const [requiredRole, prefixes] of Object.entries(ROLE_PREFIXES) as [AppRole, string[]][]) {
        if (prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))) {
          return role === requiredRole;
        }
      }
      return true;
    },
  },
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
