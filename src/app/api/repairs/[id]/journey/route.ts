import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import { requireRepairAccess } from "@/lib/repair-access";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok } from "@/lib/api";
import { HttpError } from "@/lib/api";
import { activeBranch } from "@/lib/branch";
import { BRANCH_COOKIE } from "@/lib/branch";
import { ticketJourney } from "@/lib/journey";

export const dynamic = "force-dynamic";

/** «مسیر تعمیر» — خط زمانی کامل و فقط-خواندنی یک پذیرش */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = requireSession(req);
    requirePerm(session, "repairs.view");
    const { id } = await params;
    requireRepairAccess(session, Number(id), req.cookies.get("repaid_branch")?.value);
    const ticketId = Number(id);
    if (!Number.isFinite(ticketId)) throw new HttpError(400, "شناسهٔ پذیرش نامعتبر است.");
    const db = getDb();
    const ticket = db.prepare("SELECT id, branch_id, technician_id, technician2_id FROM repair_tickets WHERE id = ?").get(ticketId) as any;
    if (!ticket) throw new HttpError(404, "پذیرش یافت نشد.");

    const privileged = ["owner", "admin"].includes(session.user.role);
    const isAssigned =
      Number(ticket.technician_id) === session.user.id || Number(ticket.technician2_id) === session.user.id;
    const scope = activeBranch(session, req.cookies.get(BRANCH_COOKIE)?.value);
    const inBranch =
      scope.all || scope.branchId == null || ticket.branch_id == null || Number(ticket.branch_id) === scope.branchId;

    // دسترسی: مدیر/همان شعبه/تعمیرکارِ ارجاع‌شده. تعمیرکار ارجاع‌شده حتی از شعبهٔ دیگر
    // باید مسیر دستگاه خودش را ببیند (ارجاع بین‌شعبی توسط مدیر مجاز است).
    if (!privileged && !inBranch && !isAssigned) {
      throw new HttpError(403, "این پذیرش خارج از محدودهٔ دسترسی شماست.");
    }
    if (
      session.user.role === "technician" &&
      repairReadAssignedOnly(session) &&
      !isAssigned
    ) {
      throw new HttpError(403, "این پذیرش به شما ارجاع نشده است.");
    }

    const data = ticketJourney(ticketId, { id: session.user.id, privileged });
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
