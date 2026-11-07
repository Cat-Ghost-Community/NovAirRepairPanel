import { getDb } from "./db/schema";
import { activeBranch, BRANCH_COOKIE } from "./branch";
import { type Session } from "./auth";
import { HttpError } from "./api";
import {repairReadAssignedOnly} from './repair-workflow';

export function requireRepairAccess(session: Session, ticketId: number, branchCookie?: string | null) {
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new HttpError(404, "پذیرش یافت نشد.");
  const row = getDb().prepare("SELECT id,branch_id,technician_id,technician2_id FROM repair_tickets WHERE id=?").get(ticketId) as
    { id: number; branch_id: number; technician_id: number | null; technician2_id: number | null } | undefined;
  if (!row) throw new HttpError(404, "پذیرش یافت نشد.");
  requireRepairRowsAccess(session, [row], branchCookie);
  return row;
}

export function requireRepairRowsAccess(session: Session, rows: Array<{ branch_id: unknown; technician_id: unknown; technician2_id: unknown }>, branchCookie?: string | null) {
  const scope = activeBranch(session, branchCookie);
  const assignedOnly = repairReadAssignedOnly(session);
  if (rows.some(row => !scope.all && Number(row.branch_id) !== scope.branchId)) throw new HttpError(404, "پذیرش یافت نشد.");
  if (assignedOnly && rows.some(row => row.technician_id !== session.user.id && row.technician2_id !== session.user.id)) throw new HttpError(403, "دسترسی به این پذیرش مجاز نیست.");
}

export { BRANCH_COOKIE };
