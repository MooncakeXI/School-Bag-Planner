import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolveActor, type Actor } from "./actor";

export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return resolveActor(userId);
}

/** Redirects to /login if there is no session. Use in a protected route's layout. */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}
