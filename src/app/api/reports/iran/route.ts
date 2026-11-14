import { NextRequest } from "next/server";
import { financialStatements,trialBalance,signedSafe } from '@/lib/accounting';
import { multiplyRial,addQuantity } from '@/lib/money';
import { reconcileSubledgers } from '@/lib/accounting-reports';
import { activeBranch,BRANCH_COOKIE } from '@/lib/branch';
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok,HttpError } from "@/lib/api";
import { readSnapshot } from '@/lib/db/transaction';

export const dynamic = "force-dynamic";

/**
 * گزارش‌های حسابداری ایرانی:
 * ?type=ar_ap  → بدهکاران و بستانکاران
 * ?type=journal&days=N → دفتر روزنامه (اسناد دریافت/پرداخت/خرید/فروش)
 * ?type=pl&days=N → سود و زیان تفکیکی (اجرت‌ها، قطعات، فروش، هزینه‌ها)
 * ?type=stock_value → موجودی ریالی انبار
 */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "finance.view");
    const db = getDb();
    const sp = req.nextUrl.searchParams;
    const type = sp.get("type") ?? "pl";
    const days = Number(sp.get("days") ?? 30);if(!Number.isSafeInteger(days)||days<1||days>730)throw new HttpError(400,'بازهٔ گزارش باید بین یک تا ۷۳۰ روز باشد.');
    const since = `datetime('now','-${days} days')`;

    const financialBranch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const response=readSnapshot(db,()=>{
    if (type === "ar_ap") {
      // بدهکاران: مشتریانی که مانده فاکتور دارند؛ بستانکاران: بیعانه/پیش‌پرداخت بدون فاکتور باز
      const balances=`WITH positions AS (SELECT kind,party_id,SUM(amount) balance FROM party_balance_events WHERE (:financialBranch IS NULL OR branch_id=:financialBranch) GROUP BY kind,party_id)`;
      const debtors=db.prepare(`${balances} SELECT c.id,c.first_name||' '||COALESCE(c.last_name,'') name,c.mobile,c.credit_limit,p.balance FROM positions p JOIN customers c ON c.id=p.party_id WHERE p.kind='customer' AND p.balance>0 ORDER BY p.balance DESC LIMIT 100`).all({financialBranch});
      const creditors=db.prepare(`${balances} SELECT c.id,c.first_name||' '||COALESCE(c.last_name,'') name,c.mobile,-p.balance credit FROM positions p JOIN customers c ON c.id=p.party_id WHERE p.kind='customer' AND p.balance<0 ORDER BY credit DESC LIMIT 100`).all({financialBranch});
      const supplierDebts=db.prepare(`${balances} SELECT s.id,s.name,p.balance debt FROM positions p JOIN suppliers s ON s.id=p.party_id WHERE p.kind='supplier' AND p.balance>0 ORDER BY p.balance DESC LIMIT 100`).all({financialBranch});
      return ok({ debtors, creditors, supplier_debts: supplierDebts });
    }

    if (type === "journal") {
      // دفتر روزنامه: تمام اسناد مالی در بازه
      const rows=db.prepare(`SELECT j.posting_date date,'JRN-'||j.posted_sequence doc,a.name party,l.debit,l.credit,j.memo note FROM accounting_journals j JOIN accounting_lines l ON l.journal_id=j.id JOIN accounting_accounts a ON a.code=l.account_code WHERE j.state IN ('posted','reversed') AND j.posting_date>=date('now',:period) AND (:financialBranch IS NULL OR j.branch_id=:financialBranch) ORDER BY j.posted_sequence DESC,l.position LIMIT 501`).all({financialBranch,period:`-${days} days`});
      return ok({rows:rows.slice(0,500).map(row=>({...row,kind:'\u062f\u0641\u062a\u0631\u06a9\u0644'})),truncated:rows.length>500,basis:'posted_journals_only'});
    }

    if (type === "stock_value") {
      const after=Number(sp.get('after')??0);if(!Number.isSafeInteger(after)||after<0)throw new HttpError(400,'صفحهٔ موجودی معتبر نیست.');
      const rows:Array<{id:number;name:string;category:unknown;purchase_price:number;price:number;qty:number;stock_value:number;retail_value:number}>=[];
      let current:typeof rows[number]|undefined,cost=BigInt(0),retail=BigInt(0),more=false;
      const flush=()=>{if(!current)return;if(current.id>after){if(rows.length<200)rows.push(current);else more=true;}};
      for(const stock of db.prepare(`SELECT p.id,p.name,p.category,p.purchase_price,p.avg_cost,p.price,s.qty,s.carrying_value FROM inventory_stock s JOIN parts p ON p.id=s.part_id JOIN inventory_locations l ON l.id=s.location_id WHERE (:financialBranch IS NULL OR l.branch_id=:financialBranch) ORDER BY p.id,s.id`).iterate({financialBranch})){
        if(!current||current.id!==stock.id){flush();current={id:Number(stock.id),name:String(stock.name),category:stock.category,purchase_price:Number(stock.purchase_price),price:Number(stock.price),qty:0,stock_value:0,retail_value:0};}
        const qty=Number(stock.qty),sign=qty<0?-1:1,value=stock.carrying_value==null?multiplyRial(Number(stock.avg_cost),Math.abs(qty))*sign:Number(stock.carrying_value),selling=multiplyRial(Number(stock.price),Math.abs(qty))*sign;
        current.qty=addQuantity(current.qty,qty);current.stock_value=signedSafe(BigInt(current.stock_value)+BigInt(value));current.retail_value=signedSafe(BigInt(current.retail_value)+BigInt(selling));cost+=BigInt(value);retail+=BigInt(selling);
      }flush();
      const comparison=reconcileSubledgers(db,session,financialBranch,req.cookies.get(BRANCH_COOKIE)?.value);
      return ok({rows,totals:{cost:signedSafe(cost),retail:signedSafe(retail)},next:more?rows[rows.length-1].id:null,ledger_value:comparison.inventory.ledger,difference:comparison.inventory.difference,requiresReview:comparison.requiresReview,basis:'source_inventory_with_explicit_ledger_comparison'});
    }

    // پیش‌فرض: سود و زیان تفکیکی
    const end=new Date().toISOString().slice(0,10),startDate=new Date();startDate.setUTCDate(startDate.getUTCDate()-days);
    const filters={branch_id:financialBranch,from:startDate.toISOString().slice(0,10),to:end};
    const posted=financialStatements(db,session,filters,req.cookies.get(BRANCH_COOKIE)?.value),trial=trialBalance(db,session,filters,req.cookies.get(BRANCH_COOKIE)?.value);
    const movement=(code:string)=>{const row=trial.rows.find(r=>r.code===code);return row?row.debit-row.credit:0;};
    const serviceRevenue=-movement('4010'),goodsRevenue=-movement('4000'),serviceCost=movement('5010'),goodsCost=movement('5000');
    const ledgerCategories=[{label:'خدمات تعمیرِ شناسایی‌شده',rev:serviceRevenue,cost:serviceCost,profit:serviceRevenue-serviceCost},{label:'فروش کالا و صندوقِ شناسایی‌شده',rev:goodsRevenue,cost:goodsCost,profit:goodsRevenue-goodsCost}];
    const otherRevenue=posted.revenue-serviceRevenue-goodsRevenue,otherCost=posted.cogs-serviceCost-goodsCost;
    if(otherRevenue||otherCost)ledgerCategories.push({label:'سایر حساب‌های درآمد و بها',rev:otherRevenue,cost:otherCost,profit:otherRevenue-otherCost});
    const ledgerExpenses=trial.rows.filter(r=>r.classification==='expense'&&(r.debit!==r.credit)).map(r=>({category:r.name,total:r.debit-r.credit}));
    const laborRevenue = (db.prepare(
      `SELECT COALESCE(SUM(ii.total),0) v FROM invoice_items ii JOIN effective_invoices i ON i.id = ii.invoice_id
       WHERE ii.kind IN ('service','labor','fee') AND COALESCE(i.type,'repair')!='purchase' AND i.created_at >= ${since} AND i.status NOT IN ('draft','cancelled') AND (:financialBranch IS NULL OR i.branch_id=:financialBranch)`
    ).get({financialBranch}) as any).v;
    const partsRevenue = (db.prepare(
      `SELECT COALESCE(SUM(ii.total),0) v FROM invoice_items ii JOIN effective_invoices i ON i.id = ii.invoice_id
       WHERE ii.kind = 'part' AND i.created_at >= ${since} AND i.status NOT IN ('draft','cancelled') AND (:financialBranch IS NULL OR i.branch_id=:financialBranch)`
    ).get({financialBranch}) as any).v;
    const salesRevenue = (db.prepare(
      `SELECT COALESCE(SUM(si.total),0) v FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ${since} AND s.status!='cancelled' AND (:financialBranch IS NULL OR s.branch_id=:financialBranch) AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.sale_id=s.id AND i.status NOT IN ('draft','cancelled'))`
    ).get({financialBranch}) as any).v;
    const laborCost = (db.prepare(
      `SELECT COALESCE(SUM(ii.cost * ii.qty),0) v FROM invoice_items ii JOIN effective_invoices i ON i.id = ii.invoice_id
       WHERE ii.kind IN ('service','labor','fee') AND COALESCE(i.type,'repair')!='purchase' AND i.created_at >= ${since} AND i.status NOT IN ('draft','cancelled') AND (:financialBranch IS NULL OR i.branch_id=:financialBranch)`
    ).get({financialBranch}) as any).v;
    const partsCost = (db.prepare(
      `SELECT COALESCE(SUM(ii.cost * ii.qty),0) v FROM invoice_items ii JOIN effective_invoices i ON i.id = ii.invoice_id
       WHERE ii.kind = 'part' AND i.created_at >= ${since} AND i.status NOT IN ('draft','cancelled') AND (:financialBranch IS NULL OR i.branch_id=:financialBranch)`
    ).get({financialBranch}) as any).v;
    const salesCost = (db.prepare(
      `SELECT COALESCE(SUM(si.cost * si.qty),0) v FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ${since} AND s.status!='cancelled' AND (:financialBranch IS NULL OR s.branch_id=:financialBranch) AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.sale_id=s.id AND i.status NOT IN ('draft','cancelled'))`
    ).get({financialBranch}) as any).v;
    const expensesRows = db
      .prepare(`SELECT category, SUM(amount) total FROM expenses WHERE date >= date('now','-${days} days') AND (:financialBranch IS NULL OR branch_id=:financialBranch) GROUP BY category ORDER BY total DESC`)
      .all({financialBranch}) as any[];
    const expensesTotal = expensesRows.reduce((s, r) => s + r.total, 0);
    const byTicket = db
      .prepare(
        `SELECT t.number, d.brand || ' ' || d.model device, COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'') customer,
                COALESCE(SUM(ii.total),0) revenue, COALESCE(SUM(ii.cost * ii.qty),0) cost
         FROM repair_tickets t
         JOIN effective_invoices i ON i.ticket_id = t.id
         JOIN invoice_items ii ON ii.invoice_id = i.id
         JOIN devices d ON d.id = t.device_id
         JOIN customers c ON c.id = t.customer_id
         WHERE i.created_at >= ${since} AND i.status NOT IN ('draft','cancelled') AND (:financialBranch IS NULL OR i.branch_id=:financialBranch)
         GROUP BY t.id ORDER BY revenue DESC LIMIT 30`
      )
      .all({financialBranch}) as any[];

    const laborProfit = laborRevenue - laborCost;
    const partsProfit = partsRevenue - partsCost;
    const salesProfit = salesRevenue - salesCost;

    return ok({
      services: { revenue: laborRevenue, cost: laborCost, profit: laborProfit },
      labor: { revenue: laborRevenue, cost: laborCost, profit: laborProfit },
      parts: { revenue: partsRevenue, cost: partsCost, profit: partsProfit },
      sales: { revenue: salesRevenue, cost: salesCost, profit: salesProfit },
      expenses: { rows: ledgerExpenses, total: posted.expenses },
      operational_expenses:{rows:expensesRows,total:expensesTotal}, ledger:posted, ledger_categories:ledgerCategories, basis:"posted_ledger_with_separate_operational_estimates",
      net: posted.profit,
      by_ticket: byTicket,
      days,
    });
    });response.headers.set('Cache-Control','no-store');return response;
  } catch (e) {
    return fail(e);
  }
}
