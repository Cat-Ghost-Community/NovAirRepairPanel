import { requirePageAccess } from "@/lib/page-access";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/suppliers/new");
  return children;
}
