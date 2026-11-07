/** Route authorization is enforced by the server layout, separately from navigation visibility. */
const ROUTE_PERMISSIONS: Record<string, string> = {
  repairs: "repairs.view", customers: "customers.view", devices: "devices.view",
  parts: "inventory.view", "inventory-tools": "inventory.view", serials: "inventory.view",
  suppliers: "suppliers.view", "purchase-orders": "purchasing.view", purchasing: "purchasing.view",
  pos: "sales.view", sales: "sales.view", invoices: "invoices.view", returns:'invoices.view',payments: "payments.view",
  estimates: "estimates.view", expenses: "expenses.view", finance: "finance.view",
  installments: "finance.view", checks: "finance.view", bank: "finance.view", payroll: "finance.view",
  reports: "reports.view", "report-builder": "reports.view", team: "team.view",
  settings: "settings.view", audit: "audit.view", tariffs: "repairs.view",
  appointments: "appointments.view", calendar: "appointments.view", warranty: "warranty.view",
  complaints: "complaints.view", communication: "communication.view", outbox: "communication.view",
  chat: "chat.view", labels: "repairs.view", "daily-report": "dashboard.view",
};

export function isPublicPage(pathname: string): boolean {
  return pathname === "/login" || pathname === "/track" || pathname.startsWith("/track/");
}

export function pagePermission(pathname: string): string {
  if (pathname === "/") return "dashboard.view";
  return ROUTE_PERMISSIONS[pathname.split("/")[1]] ?? "settings.view";
}
