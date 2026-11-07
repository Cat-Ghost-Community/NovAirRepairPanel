import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { getSessionByToken, canUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import IranReportsClient from "./iran-client";

export const dynamic = "force-dynamic";

export default async function IranReportsPage() {
  await requirePageAccess("/reports/iran");
  const cookieStore = await cookies();
  const session = getSessionByToken(cookieStore.get("repaid_session")?.value);
  if (!session) redirect("/login");
  if (!canUser(session, "finance.view")) redirect("/");
  const store = await cookies();
  return <IranReportsClient />;
}
