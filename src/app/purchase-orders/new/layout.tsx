import { requirePageAccess } from "@/lib/page-access";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await requirePageAccess("/purchase-orders/new");
  return children;
}
