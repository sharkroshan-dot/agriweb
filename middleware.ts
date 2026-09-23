import { withAuth } from "next-auth/middleware";

export default withAuth({
  // Keep public routes renderable in the v0 preview when project secrets are not injected.
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "agriconnect-dev-secret",
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ token, req }) {
      const { pathname } = req.nextUrl;
      const publicPaths = ["/", "/login", "/register", "/search", "/product", "/categories", "/roadmap", "/api", "/_next", "/images", "/marketplace", "/nearby", "/trace"];
      if (publicPaths.some((p) => pathname.startsWith(p))) {
        return true;
      }
      return !!token;
    },
  },
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
