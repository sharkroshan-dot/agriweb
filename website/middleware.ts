import { withAuth } from "next-auth/middleware";

export default withAuth({
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
