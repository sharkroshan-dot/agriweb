import type { DefaultSession } from "next-auth";

type AppRole = "customer" | "farmer" | "warehouse" | "delivery" | "admin" | "business";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id?: string;
      role?: AppRole;
    };
  }

  interface User {
    role?: AppRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: AppRole;
    accessToken?: string;
    refreshToken?: string;
  }
}
