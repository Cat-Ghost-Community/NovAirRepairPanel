import type { DatabaseSync } from "node:sqlite";
import { HttpError, ok, responseData } from "@/lib/api";
import { atomic } from "@/lib/db/transaction";
import {operationHash,operationKey} from '@/lib/operation-identity';

/** No expiry: deleting an operation identity would permit a delayed duplicate.
 * Receipt and business mutations commit together. Failed attempts leave no receipt. */
export function durableOperation<T>(db: DatabaseSync, options: {
  actorId: number; branchId: number; operation: string; key: unknown; payload: unknown; scope?: "branch" | "business";
}, work: () => T): T {
  const key = operationKey(options.key);
  const scope = options.scope ?? "branch";
  const hash = operationHash(options.payload);
  return atomic(db, () => {
    const prior = db.prepare(`SELECT request_hash, result_json,branch_id FROM operation_receipts
      WHERE actor_id=? AND operation=? AND operation_key=? AND scope=? ${scope === "branch" ? "AND branch_id=?" : ""}`)
      .get(options.actorId, options.operation, key, scope, ...(scope === "branch" ? [options.branchId] : [])) as { request_hash: string; result_json: string;branch_id:number } | undefined;
    if (prior) {
      if(prior.branch_id!==options.branchId){
        const actor=db.prepare('SELECT role,is_active FROM users WHERE id=?').get(options.actorId);
        if(actor?.is_active!==1||!['owner','admin'].includes(String(actor.role)))throw new HttpError(409,'شناسهٔ عملیات متعلق به شعبهٔ دیگری است؛ سابقهٔ اصلی را در شعبهٔ مجاز بررسی کنید.');
      }
      if (prior.request_hash !== hash) throw new HttpError(409, "این شناسه قبلاً برای درخواست دیگری استفاده شده است.");
      return JSON.parse(prior.result_json) as T;
    }
    const result = work();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Idempotent work must be synchronous");
    db.prepare(`INSERT INTO operation_receipts(actor_id,branch_id,operation,operation_key,request_hash,result_json,scope)
      VALUES(?,?,?,?,?,?,?)`).run(options.actorId, options.branchId, options.operation, key, hash, JSON.stringify(result), scope);
    return result;
  });
}

class RejectedResponse extends Error {
  constructor(readonly response: Response) { super("Rejected transaction response"); }
}

/** Adapt existing synchronous handlers without consuming a response stream or
 * awaiting inside a write transaction. Error responses roll back too. */
export function durableJsonResponse(db: DatabaseSync, options: Parameters<typeof durableOperation>[1], work: () => Response): Response {
  try {
    const result = durableOperation(db, options, () => {
      const response = work();
      if (response.status >= 400) throw new RejectedResponse(response);
      const body = responseData(response);
      if (!body.found) throw new Error("Transactional success responses must use ok()");
      return { status: response.status, body: body.data };
    });
    return ok(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof RejectedResponse) return error.response;
    throw error;
  }
}
