import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Database sessions, not JWT-only — see CLAUDE.md "Auth warning". Under
  // JWT-only, @auth/core regenerates profile.sub with crypto.randomUUID()
  // on every login and the stable user id is lost.
  session: { strategy: "database" },
  providers: [Google],
  pages: { signIn: "/login" },
  events: {
    // Teacher/Parent profiles are created ahead of time by whoever sets up
    // the school, before that person has ever logged in — so their row
    // has an email but no userId yet. Link it the first time someone
    // signs in with a matching, Google-verified email. A no-op once
    // already linked.
    async signIn({ user }) {
      if (!user.id || !user.email) return;
      await Promise.all([
        prisma.teacher.updateMany({ where: { email: user.email, userId: null }, data: { userId: user.id } }),
        prisma.parent.updateMany({ where: { email: user.email, userId: null }, data: { userId: user.id } }),
      ]);
    },
  },
});
