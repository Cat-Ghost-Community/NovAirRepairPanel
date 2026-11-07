import {before,after,describe,it} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-payroll-branch-'));process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,payroll:typeof import('../src/lib/payroll');
before(async()=>{db=(await import('../src/lib/db/schema')).getDb();payroll=await import('../src/lib/payroll');db.exec("INSERT INTO branches(id,name,code) VALUES(1,'ONE','ONE'),(2,'TWO','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','o@test','x','owner',1),(2,'Employee','e@test','x','technician',1);INSERT INTO payroll_deductions(user_id,amount,reason,date,created_by) VALUES(2,75,'other','2026-10-29',1);");});
after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
describe('payroll deduction history retains original financial branch',()=>{
 it('does not move previous deductions when employment changes',()=>{
  payroll.addDeduction(2,100,'other','2026-10-29','Original branch evidence',1,1);db.prepare('UPDATE users SET branch_id=2 WHERE id=2').run();payroll.addDeduction(2,50,'other','2026-10-29','New branch evidence',1,2);
  assert.equal(payroll.payrollReport(2,'2026-10-01','2026-10-31',1).deductions,100);assert.equal(payroll.payrollReport(2,'2026-10-01','2026-10-31',2).deductions,50);assert.equal(payroll.payrollReport(2,'2026-10-01','2026-10-31').deductions,225);
  assert.equal(db.prepare('SELECT branch_id FROM payroll_deductions WHERE amount=75').get()!.branch_id,null);assert.throws(()=>db.prepare('UPDATE payroll_deductions SET branch_id=2 WHERE amount=100').run(),/immutable/);
 });
});
