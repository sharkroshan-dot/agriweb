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

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const { pathname } = req.nextUrl;
    const requiredRole = Object.entries(ROLE_PROTECTED_PREFIXES).find(
      ([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"),
    )?.[1];

    if (requiredRole && token?.role !== requiredRole) {
      const destination = req.nextUrl.clone();
      const role = typeof token?.role === "string" ? token.role : "";
      destination.pathname =
        role && ROLE_PROTECTED_PREFIXES ? `/${role}/dashboard` : "/login";
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
        const publicPaths = ["/", "/login", "/register", "/search", "/product", "/categories", "/roadmap", "/api", "/_next", "/images", "/marketplace", "/nearby", "/trace"];
        if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
        return !!token;
      },
    },
  },
);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
