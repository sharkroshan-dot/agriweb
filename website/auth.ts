import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
type AppRole = "customer" | "farmer" | "warehouse" | "delivery" | "admin" | "business";

function normalizeRole(role?: string): AppRole {
  switch (role?.toLowerCase()) {
    case "farmer":
      return "farmer";
    case "warehouse":
      return "warehouse";
    case "delivery":
      return "delivery";
    case "admin":
      return "admin";
    case "business":
      return "business";
    default:
      return "customer";
  }
}

async function authenticateWithBackend(identifier: string, password: string, isDelivery: boolean = false) {
  const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:8000";
  const apiBaseUrl = rawApiBaseUrl.endsWith("/api/v1") ? rawApiBaseUrl : `${rawApiBaseUrl.replace(/\/$/, "")}/api/v1`;

  let response: Response;
  try {
    // Delivery partners use phone number as primary identifier with OTP
    const loginMethod = isDelivery ? "phone" : "username";
    response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ username: identifier, password, login_method: loginMethod }),
    });
  } catch {
    throw new Error("Network error");
  }

  if (!response.ok) {
    const reason = response.status === 403 ? "Account not verified" : "Invalid credentials";
    throw new Error(reason);
  }

  const payload = await response.json();
  const user = payload.user || {};

  return {
    id: user.id || user.userId || identifier,
    email: user.email || identifier,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || identifier,
    image: user.avatar_url || user.avatarUrl,
    role: normalizeRole(user.role),
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
  };
}

async function refreshBackendAccessToken(refreshToken: string) {
  const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:8000";
  const apiBaseUrl = rawApiBaseUrl.endsWith("/api/v1") ? rawApiBaseUrl : `${rawApiBaseUrl.replace(/\/$/, "")}/api/v1`;

  try {
    const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Next.js evaluates this module during `next build`. Keep the module
// build-safe when deployment secrets are injected only at runtime.
const authSecret =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  "agriconnect-build-secret-change-in-production";

export const authOptions = {
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        phone: { label: "Phone Number", type: "tel" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        role: { label: "Role", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toString() || "";
        const password = credentials?.password?.toString() || "";
        const requestedRole = normalizeRole(credentials?.role?.toString());
        const phone = credentials?.phone?.toString() || "";

        // For delivery partners, prioritize phone number login with OTP
        if (requestedRole === "delivery" && phone) {
          if (!email) {
            // Use phone as the identifier
            const backendUser = await authenticateWithBackend(phone, password, true);
            if (backendUser) {
              return requestedRole && backendUser.role !== requestedRole ? null : backendUser;
            }
            return null;
          }
        }

        if (!email || !password) {
          return null;
        }

        const backendUser = await authenticateWithBackend(email, password);
        if (backendUser) {
          return requestedRole && backendUser.role !== requestedRole ? null : backendUser;
        }

        return null;
      },
    }),
    Credentials({
      id: "otp",
      name: "OTP",
      credentials: {
        id: {},
        email: {},
        name: {},
        image: {},
        role: {},
        accessToken: {},
        refreshToken: {},
      },
async authorize(credentials) {
        const accessToken = credentials?.accessToken?.toString() || "";
        if (!accessToken) {
          return null;
        }

        // Validate the token against the backend and derive the real role,
        // so a client cannot mint a session claiming any role it likes.
        const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:8000";
        const apiBaseUrl = rawApiBaseUrl.endsWith("/api/v1") ? rawApiBaseUrl : `${rawApiBaseUrl.replace(/\/$/, "")}/api/v1`;
        try {
          const me = await fetch(`${apiBaseUrl}/users/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!me.ok) {
            return null;
          }
          const backendUser = await me.json();
          const userId = backendUser?.id || backendUser?.userId || credentials?.id?.toString() || "";
          if (!userId) {
            return null;
          }
          return {
            id: userId,
            email: backendUser?.email || credentials?.email?.toString() || "",
            name: [backendUser?.first_name || backendUser?.firstName, backendUser?.last_name || backendUser?.lastName].filter(Boolean).join(" ") || "",
            image: backendUser?.avatar_url || backendUser?.avatarUrl || null,
            role: normalizeRole(backendUser?.role),
            accessToken,
            refreshToken: credentials?.refreshToken?.toString() || "",
            expiresIn: 3600,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.picture = user.image;
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.accessTokenExpires = Date.now() + ((user as any).expiresIn || 3600) * 1000;
      } else if (token.accessToken && token.refreshToken &&
        Number(token.accessTokenExpires || 0) <= Date.now() + 30_000) {
        const refreshed = await refreshBackendAccessToken(token.refreshToken as string);
        if (refreshed?.access_token) {
          token.accessToken = refreshed.access_token;
          token.accessTokenExpires = Date.now() + (refreshed.expires_in || 3600) * 1000;
        } else {
          token.error = "RefreshAccessTokenError";
        }
      }
      if (trigger === "update" && session) {
        token.picture = (session as any).image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as AppRole;
        session.user.image = token.picture as string;
      }
      (session as any).accessToken = token.accessToken;
      (session as any).refreshToken = token.refreshToken;
      return session;
    },
  },
};
 
const nextAuthHandler = NextAuth(authOptions as any);
 
export const handlers = {
  GET: nextAuthHandler,
  POST: nextAuthHandler,
};
 
export default nextAuthHandler;
