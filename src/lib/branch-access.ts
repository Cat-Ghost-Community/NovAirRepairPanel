import type { DatabaseSync } from "node:sqlite";
import type { Session } from "./auth";
import { activeBranch,canSwitchBranch } from "./branch";
import { HttpError } from "./api";

/** Fixed SQL identifiers only. Unknown or unattributed records fail closed for staff. */
const RESOURCES = {
  customer: "SELECT id customer_id,branch_id FROM customers WHERE id=?",
  device: "SELECT d.customer_id,d.branch_id FROM devices d WHERE d.id=?",
  ticket: "SELECT branch_id FROM repair_tickets WHERE id=?",
  invoice: "SELECT branch_id FROM invoices WHERE id=?",
  sale: "SELECT branch_id FROM sales WHERE id=?",
  payment: "SELECT branch_id FROM payments WHERE id=?",
  expense: "SELECT branch_id FROM expenses WHERE id=?",
  appointment: "SELECT branch_id FROM appointments WHERE id=?",
  purchase: "SELECT branch_id FROM purchase_orders WHERE id=?",
  location: "SELECT branch_id FROM inventory_locations WHERE id=?",
  user: "SELECT branch_id FROM users WHERE id=? AND is_active=1",
  complaint: "SELECT COALESCE(x.branch_id,t.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=x.customer_id HAVING COUNT(*)=1)) branch_id FROM complaints x LEFT JOIN repair_tickets t ON t.id=x.ticket_id LEFT JOIN customers c ON c.id=x.customer_id WHERE x.id=?",
  warranty: "SELECT COALESCE(w.branch_id,t.branch_id,i.branch_id,s.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=w.customer_id HAVING COUNT(*)=1)) branch_id FROM warranties w LEFT JOIN repair_tickets t ON t.id=w.ticket_id LEFT JOIN invoices i ON i.id=w.invoice_id LEFT JOIN sales s ON s.id=w.sale_id LEFT JOIN customers c ON c.id=w.customer_id WHERE w.id=?",
  claim: "SELECT COALESCE(w.branch_id,t.branch_id,i.branch_id,s.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=w.customer_id HAVING COUNT(*)=1)) branch_id FROM warranty_claims x JOIN warranties w ON w.id=x.warranty_id LEFT JOIN repair_tickets t ON t.id=w.ticket_id LEFT JOIN invoices i ON i.id=w.invoice_id LEFT JOIN sales s ON s.id=w.sale_id LEFT JOIN customers c ON c.id=w.customer_id WHERE x.id=?",
  message: "SELECT COALESCE(m.branch_id,t.branch_id,c.branch_id,(SELECT MIN(a.branch_id) FROM customer_branch_access a WHERE a.customer_id=m.customer_id HAVING COUNT(*)=1)) branch_id FROM messages m LEFT JOIN repair_tickets t ON t.id=m.ticket_id LEFT JOIN customers c ON c.id=m.customer_id WHERE m.id=?",
  serial: "SELECT COALESCE(l.branch_id,t.branch_id,sale.branch_id) branch_id FROM serialized_parts s LEFT JOIN inventory_locations l ON l.id=s.location_id LEFT JOIN repair_tickets t ON t.id=s.ticket_id LEFT JOIN sales sale ON sale.id=s.sale_id WHERE s.id=?",
} as const;
export type BranchResource = keyof typeof RESOURCES;

export function assertBranchResource(db: DatabaseSync, session: Session, cookie: string | undefined, resource: BranchResource, value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "شناسهٔ معتبر لازم است.");
  const scope = activeBranch(session, cookie);
  const row = db.prepare(RESOURCES[resource]).get(id) as { branch_id: number | null;customer_id?:number } | undefined;
  const legacyAccess=row?.branch_id==null && row?.customer_id!=null && (resource==="device"
    ?db.prepare("SELECT 1 FROM device_branch_access WHERE device_id=? AND branch_id=?").get(id,scope.branchId)
    :db.prepare("SELECT 1 FROM customer_branch_access WHERE customer_id=? AND branch_id=?").get(row.customer_id,scope.branchId));
  if (!row || (!scope.all && row.branch_id !== scope.branchId && !legacyAccess)) throw new HttpError(404, "رکورد در شعبهٔ مجاز یافت نشد.");
  return row;
}

/** A shared legacy identity is readable through local source evidence, but not editable by one branch. */
export function assertBranchProfileWrite(db:DatabaseSync,session:Session,cookie:string|undefined,resource:"customer"|"device",value:unknown){
  const row=assertBranchResource(db,session,cookie,resource,value);
  if(!canSwitchBranch(session.user.role) && row.branch_id==null){
    const count=Number((resource==="device"?db.prepare("SELECT COUNT(*) n FROM device_branch_access WHERE device_id=?").get(Number(value)):db.prepare("SELECT COUNT(*) n FROM customer_branch_access WHERE customer_id=?").get(row.customer_id!))?.n??0);
    if(count!==1)throw new HttpError(403,"این نمایهٔ قدیمی بین شعبه‌ها مشترک است؛ ویرایش آن باید توسط مدیر شرکت انجام شود.");
  }
  return row;
}

const REFERENCES: Record<string, BranchResource> = {
  customer_id: "customer", referrer_customer_id: "customer", device_id: "device", ticket_id: "ticket",
  invoice_id: "invoice", sale_id: "sale", payment_id: "payment", expense_id: "expense", appointment_id: "appointment",
  purchase_order_id: "purchase", po_id: "purchase", location_id: "location", from_location_id: "location", to_location_id: "location",
  technician_id: "user", technician2_id: "user", assigned_to: "user", warranty_id: "warranty",
  claim_id: "claim",
};

/** Defense in depth for API references; domain authorization remains mandatory. */
export function assertBranchReferences(db: DatabaseSync, session: Session, cookie: string | undefined, values: Record<string, unknown>) {
  const scope = activeBranch(session, cookie);
  if (values.branch_id != null && values.branch_id !== "" && !scope.all && Number(values.branch_id) !== scope.branchId) {
    throw new HttpError(403, "دسترسی به شعبهٔ دیگر مجاز نیست.");
  }
  for (const [key, resource] of Object.entries(REFERENCES)) {
    const value = values[key];
    if (value != null && value !== "" && value !== 0 && value !== "0") assertBranchResource(db, session, cookie, resource, value);
  }
}

export function assertBranchPath(db: DatabaseSync, session: Session, cookie: string | undefined, pathname: string,method="GET") {
  const match = pathname.match(/^\/api\/(customers|devices|repairs|invoices|sales|payments|expenses|appointments|complaints|warranties|purchasing|purchase-orders)\/(\d+)(?:\/|$)/);
  if (!match) return;
  const resources: Record<string, BranchResource> = { customers: "customer", devices: "device", repairs: "ticket", invoices: "invoice", sales: "sale", payments: "payment", expenses: "expense", appointments: "appointment", complaints: "complaint", warranties: "warranty", purchasing: "purchase", "purchase-orders":"purchase" };
  assertBranchResource(db, session, cookie, resources[match[1]], match[2]);
  if(["customer","device"].includes(resources[match[1]]) && !["GET","HEAD"].includes(method))assertBranchProfileWrite(db,session,cookie,resources[match[1]] as "customer"|"device",match[2]);
}
