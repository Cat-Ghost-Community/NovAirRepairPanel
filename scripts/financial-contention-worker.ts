// Only invoked by real SQLite concurrency tests against an explicit isolated DB.
import { getDb } from "../src/lib/db/schema";
import { durableOperation } from "../src/lib/idempotency";
import { createCustomerReceipt } from "../src/lib/customer-payments";
import { HttpError } from "../src/lib/api";
import type { Session } from "../src/lib/auth";

async function main() {
  if (process.env.FINANCIAL_TEST_MODE !== "1" || !process.env.REPAID_DATA_DIR) throw new Error("Explicit financial test fixture required");
  const [entity, key, amount, mode, from, to] = process.argv.slice(2);
  const db = getDb();
  try {
    if(mode==="journal"){
      const {createSession}=await import("../src/lib/auth");const {NextRequest}=await import("next/server");const {POST}=await import("../src/app/api/accounting/route");
      const expectedHash=db.prepare("SELECT request_hash FROM accounting_journals WHERE id=?").get(Number(entity))!.request_hash;
      const response=await POST(new NextRequest("http://app.test/api/accounting",{method:"POST",headers:{origin:"http://app.test","content-type":"application/json","idempotency-key":key,cookie:`repaid_session=${createSession(1)}`},body:JSON.stringify({action:"post",id:Number(entity),expected_hash:expectedHash})}));
      process.stdout.write(JSON.stringify({...await response.json(),status:response.status}));return;
    }
    if(mode==="commission"){
      const {createSession}=await import("../src/lib/auth");
      const {NextRequest}=await import("next/server");
      const {POST}=await import("../src/app/api/payroll/route");
      const response=await POST(new NextRequest("http://app.test/api/payroll",{method:"POST",headers:{origin:"http://app.test","content-type":"application/json","idempotency-key":key,cookie:`repaid_session=${createSession(1)}`},
        body:JSON.stringify({action:"pay_run",id:Number(entity),amount:Number(amount),method:"cash",payment_date:"2026-10-24",document_reference:`receipt-${key}`,confirmed:true})}));
      process.stdout.write(JSON.stringify({...await response.json(),status:response.status}));return;
    }
    if (mode === "stock") {
      const { createSession } = await import("../src/lib/auth");
      const { NextRequest } = await import("next/server");
      const { POST } = await import("../src/app/api/inventory/tools/route");
      const request = new NextRequest("http://app.test/api/inventory/tools", { method: "POST", headers: {
        origin: "http://app.test", "content-type": "application/json", "idempotency-key": key, cookie: `repaid_session=${createSession(1)}`,
      }, body: JSON.stringify({ action: "transfer", part_id: Number(entity), from_location: Number(from), to_location: Number(to), qty: Number(amount) }) });
      const response = await POST(request);
      process.stdout.write(JSON.stringify({ ...await response.json(), status: response.status }));
      return;
    }
    const user = db.prepare("SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=1").get() as Session["user"];
    const body = { invoice_id: Number(entity), amount: Number(amount), method: "cash" };
    const result = durableOperation(db, { actorId: user.id, branchId: 1, operation: "customer_receipt", key, payload: body },
      () => createCustomerReceipt(db, { user }, body, 1));
    process.stdout.write(JSON.stringify({ ...result, status: 200 }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: error instanceof HttpError ? error.status : 500 }));
    if (!(error instanceof HttpError)) throw error;
  } finally { db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
