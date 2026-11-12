// Real compiled browser/SQLite/ledger acceptance; explicit disposable data only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { chromium } = require('playwright-core');
const fixture = JSON.parse(fs.readFileSync('.qa-work/fixture-20.json', 'utf8')), directory = fs.realpathSync(fixture.directory);
if (process.env.GROUP_RECEIPT_QA !== '1' || !directory.startsWith(fs.realpathSync('.qa-work/fixtures') + path.sep))
    throw Error('Disposable group receipt fixture required');
require('./test-environment.cjs');
process.env.REPAID_DATA_DIR = directory;
process.env.REPAID_DEMO_MODE = '0';
const { getDb, DB_PATH } = require('../src/lib/db/schema.ts');
assert.equal(DB_PATH, path.join(directory, 'repaid.db'));
const db = getDb(), auth = require('../src/lib/auth.ts'), ledger = require('../src/lib/accounting.ts'), opening = require('../src/lib/accounting-opening.ts'), policies = require('../src/lib/accounting-policy.ts');
const BASE = 'http://127.0.0.1:3002', out = '.qa-work/group-receipt-browser', checks = [], captures = [], errors = [], stamp = String(Date.now()), date = new Date().toISOString().slice(0,10);
fs.mkdirSync(out, { recursive: true });
const check = (name, value) => { assert.ok(value, name); checks.push(name); }, row = (sql, ...p) => db.prepare(sql).get(...p), count = (table) => row('SELECT COUNT(*) n FROM ' + table).n;
let browser;
async function clickPost(page, button, url) { const waiting = page.waitForResponse(r => r.url().includes(url) && r.request().method() === 'POST'); await button.click(); const response = await waiting; assert.equal(response.status(), 200, await response.text()); return response; }
async function chooseInvoice(page,id){
    const native=page.locator('select[aria-label="فاکتور مقصد اعتبار"]');
    const label=await native.evaluate((element,value)=>[...element.options].find(option=>option.value===String(value)).label,id);
    await native.locator('xpath=following-sibling::button[1]').click();
    const popup=page.locator('.search-select-panel:popover-open');
    await popup.locator('input[type="search"]').fill(label.split(' · ')[0]);
    await popup.getByRole('option',{name:label,exact:true}).click();
}
(async () => {
    try {
        const owner = { user: row("SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE email='owner@repaid.local'") };
        // This acceptance scenario explicitly exercises the existing no-tax
        // service policy; it does not approve production tax settings.
        for(const key of ['vat_enabled','tax_rate','duty_rate','round_to'])db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,'0');
        assert.ok(owner.user);
        const branch = Number(db.prepare("INSERT INTO branches(name,code) VALUES('شعبهٔ آزمون قبض نقدی',?)").run('GROUP-' + stamp).lastInsertRowid), mobile = '0919' + stamp.slice(-7);
        const customer = Number(db.prepare("INSERT INTO customers(first_name,last_name,mobile,branch_id) VALUES('مشتری','آزمون قبض نقدی',?,?)").run(mobile, branch).lastInsertRowid), password = 'isolated-group-browser-only';
        const addUser = db.prepare('INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,?,?)'), reviewId = Number(addUser.run('بازبین مستقل قبض', 'group-review-' + stamp + '@test.local', auth.hashPassword(password), 'owner', branch).lastInsertRowid), staffId = Number(addUser.run('پذیرش بدون وجه', 'group-staff-' + stamp + '@test.local', auth.hashPassword(password), 'accountant', branch).lastInsertRowid), foreignId = Number(addUser.run('کارمند شعبه دیگر', 'group-foreign-' + stamp + '@test.local', auth.hashPassword(password), 'accountant', 2).lastInsertRowid);
        for (const id of [staffId, foreignId])
            for (const perm of ['repairs.view', 'repairs.create', 'customers.view'])
                db.prepare("INSERT INTO user_permissions(user_id,perm,effect) VALUES(?,?,'allow')").run(id, perm);
        db.prepare("INSERT INTO user_permissions(user_id,perm,effect) VALUES(?,'payments.create','deny')").run(staffId);
        const reviewer = { user: row('SELECT id,name,email,role,branch_id,avatar_color FROM users WHERE id=?', reviewId) };
        ledger.initializeChart(db, owner);
        if (!row("SELECT id FROM accounting_periods WHERE status='open' AND ? BETWEEN start_date AND end_date", date))
            ledger.createPeriod(db, owner, { name: 'Group acceptance year', start_date: date.slice(0, 4) + '-01-01', end_date: date.slice(0, 4) + '-12-31' });
        const o = opening.proposeOpening(db, owner, { branch_id: branch, mode: 'new_business', cutover_date: date, memo: 'Independent explicit fixture zero opening', lines: [], controls: opening.openingControlCodes.map(account_code => ({ account_code, balance: 0, reference: 'Actual empty acceptance branch' })), evidence: ['Disposable independent opening source'] });
        opening.decideOpening(db, reviewer, o.id, 'approved');
        await opening.rehearseOpening(db, owner, o.id);
        opening.applyOpening(db, owner, o.id);
        for (const kind of ['cash_advance_v1', 'service_invoice_v1']) {
            const p = policies.proposeRecognitionPolicy(db, owner, { branch_id: branch, kind, effective_date: date, reason: 'Independent disposable recognition rule' });
            policies.changeRecognitionPolicy(db, reviewer, p.id, 'approve');
        }
        const invoice = require('../src/lib/invoice.ts').createInvoice(owner, { type: 'sale', customer_id: customer, branch_id: branch, confirm: true, date, client_key: 'group-browser-invoice-' + stamp, items: [{ kind: 'labor', name: 'تعهد واقعی آزمون', qty: 1, unit_price: 20 }] }, String(branch));
        const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright'), exe = fs.readdirSync(cache).filter(n => n.startsWith('chromium-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map(n => path.join(cache, n, 'chrome-win64/chrome.exe')).find(fs.existsSync);
        browser = await chromium.launch({ executablePath: exe, headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        const login = await context.request.post(BASE + '/api/auth/login', { data: { email: 'owner@repaid.local', password: 'demo1234' }, headers: { origin: BASE } });
        check('Real owner login', login.status() === 200);
        await context.addCookies([{ name: 'repaid_branch', value: String(branch), url: BASE }]);
        await page.goto(BASE + '/repairs/bulk', { waitUntil: 'networkidle' });
        await page.route('**/api/customers/lookup?*', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'جستجو موقتاً انجام نشد؛ دوباره تلاش کنید.' }) }));
        await page.getByLabel('جستجوی مشتری', { exact: true }).fill('failure');
        await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).waitFor();
        check('Customer lookup exposes an actionable failure', await page.getByRole('alert').count() > 0);
        await page.unroute('**/api/customers/lookup?*');
        await page.getByRole('button',{name:'تلاش دوباره',exact:true}).click();
        await page.getByText('مشتری پیدا نشد؛ نام کامل یا شمارهٔ همراه را جستجو کنید.',{exact:true}).waitFor();
        check('Customer lookup retry recovers to a truthful empty state',true);
        await page.getByLabel('جستجوی مشتری', { exact: true }).fill(mobile);
        await page.getByRole('button').filter({ hasText: mobile }).click();
        for (let i = 0; i < 2; i++) {
            await page.getByPlaceholder('برند *', { exact: true }).nth(i).fill('QA');
            await page.getByPlaceholder('مدل *', { exact: true }).nth(i).fill('GROUP-' + i);
            await page.getByPlaceholder('ایراد اعلام‌شده *', { exact: true }).nth(i).fill('پذیرش واقعی در پایگاه آزمون');
        }
        await page.locator('#bulk-dep').fill('1.5');
        await page.getByLabel('مرجع یکتای دریافت نقدی', { exact: true }).fill('BROWSER-GROUP-CASH-' + stamp);
        const before = count('payments');
        let requests = 0;
        const watch = r => { if (r.url().endsWith('/api/repairs/bulk') && r.method() === 'POST')
            requests++; };
        page.on('request', watch);
        await page.getByRole('button', { name: '+ افزودن دستگاه دیگر', exact: true }).click();
        await page.getByPlaceholder('برند *', { exact: true }).nth(2).fill('Incomplete');
        await page.getByRole('button', { name: 'ثبت پذیرش گروهی', exact: true }).click();
        await page.getByText('برند، مدل و ایراد همهٔ دستگاه‌ها را کامل کنید؛ هیچ ردیفی خودکار حذف نمی‌شود.', { exact: true }).waitFor();
        check('Incomplete displayed devices cannot be silently dropped', requests === 0 && count('payments') === before);
        await page.getByRole('button', { name: 'حذف', exact: true }).last().click();
        await page.getByRole('button', { name: 'ثبت پذیرش گروهی', exact: true }).click();
        await page.getByText('تحویل واقعی وجه نقد و مرجع مستند دریافت را تأیید کنید.', { exact: true }).waitFor();
        check('Unconfirmed cash cannot submit a financial request', requests === 0 && count('payments') === before);
        await page.getByRole('checkbox', { name: 'وجه نقد واقعاً تحویل گرفته شد', exact: true }).check();
        await page.locator('#bulk-dep').fill('0.01');
        await page.getByRole('button', { name: 'ثبت پذیرش گروهی', exact: true }).click();
        await page.getByText('مبلغ تومان باید صحیح یا دارای یک رقم اعشار باشد.', { exact: true }).waitFor();
        check('Sub-rial values cannot create grouped cash', requests === 0 && count('payments') === before);
        page.off('request', watch);
        await page.locator('#bulk-dep').fill('1.5');
        const sent = page.waitForRequest(r => r.url().endsWith('/api/repairs/bulk') && r.method() === 'POST'), response = await clickPost(page, page.getByRole('button', { name: 'ثبت پذیرش گروهی', exact: true }), '/api/repairs/bulk'), request = await sent, result = await response.json(), payload = request.postDataJSON(), key = request.headers()['idempotency-key'];
        check('Exact confirmed cash is persisted as 15 rial once', payload.cash_receipt.amount === 15 && result.receipt.amount === 15 && count('payments') === before + 1 && row('SELECT amount,ticket_id,invoice_id FROM payments WHERE id=?', result.receipt.id).amount === 15);
        check('Accounting result reflects real approved posting', result.receipt.accounting_state === 'posted');
        const replay = await context.request.post(BASE + '/api/repairs/bulk', { data: payload, headers: { origin: BASE, 'idempotency-key': key } });
        check('Real server replay returns the same group and receipt', replay.status() === 200 && JSON.stringify(await replay.json()) === JSON.stringify(result) && count('payments') === before + 1);
        const duplicated = await context.request.post(BASE + '/api/repairs/bulk', { data: payload, headers: { origin: BASE, 'idempotency-key': 'another-group-cash-key-' + stamp } });
        check('Different request key cannot duplicate the same documented cash source', duplicated.status() === 409 && count('payments') === before + 1);
        const gid = result.group_id;
        await page.waitForURL('**/repairs/group-receipt/' + gid);
        await page.getByRole('region', { name: 'دریافت نقدی گروه' }).waitFor();
        check('Printout identifies the actual receipt and posted ledger state', (await page.getByRole('region', { name: 'دریافت نقدی گروه' }).innerText()).includes(result.receipt.number) && (await page.getByRole('region', { name: 'دریافت نقدی گروه' }).innerText()).includes('ثبت‌شده'));
        for (const width of [320, 375, 768, 1440])
            for (const theme of ['light', 'dark'])
                for (const route of ['/repairs/bulk', '/repairs/group-receipt/' + gid]) {
                    await page.setViewportSize({ width, height: 1000 });
                    await page.goto(BASE + route, { waitUntil: 'networkidle' });
                    await page.evaluate(t => { localStorage.setItem('theme', t); document.documentElement.classList.toggle('dark', t === 'dark'); }, theme);
                    if (route === '/repairs/bulk') {
                        await page.locator('#bulk-dep').fill('1.5');
                        await page.getByLabel('مرجع یکتای دریافت نقدی', { exact: true }).fill('REFERENCE-' + stamp);
                    }
                    check('Responsive ' + route.split('/')[2] + ' ' + width + ' ' + theme, !await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1));
                    const file = out + '/' + (route === '/repairs/bulk' ? 'form' : 'receipt') + '-' + width + '-' + theme + '.png';
                    await page.screenshot({ path: file, fullPage: true });
                    captures.push(file);
                }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(BASE + '/repairs/group-receipt/' + gid, { waitUntil: 'networkidle' });
        for(const paper of ['a5','roll']){
            const button=page.getByRole('button',{name:paper==='a5'?'A5':'رول ۸ سانتی',exact:true});
            await button.click();await page.waitForURL(url=>url.searchParams.get('paper')===paper);
            await page.waitForFunction(expected=>document.querySelector('#print-area').getBoundingClientRect().width<expected,paper==='roll'?304:561);
            check('Paper control reflects the actual '+paper+' layout',await button.getAttribute('aria-pressed')==='true');
            await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);
            const file=out+'/group-'+paper+'.pdf',pdf=await page.pdf({path:file,preferCSSPageSize:true,printBackground:true}),box=pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
            check('Generated '+paper+' PDF has the intended physical width',box&&Math.abs(Number(box[1])-(paper==='roll'?226.77:419.53))<2);captures.push(file);await page.emulateMedia({media:'screen'});
        }
        await page.getByRole('button',{name:'مخفی',exact:true}).click();await page.waitForURL(url=>url.searchParams.get('price')==='0');await page.getByRole('region',{name:'دریافت نقدی گروه'}).waitFor({state:'detached'});
        check('Hide-price control updates persisted page state and active styling',await page.getByRole('button',{name:'مخفی',exact:true}).getAttribute('aria-pressed')==='true');
        await page.getByRole('button',{name:'نمایش',exact:true}).click();await page.getByRole('region',{name:'دریافت نقدی گروه'}).waitFor();
        await page.getByRole('link', { name: 'مدیریت اعتبار مشتری', exact: true }).click();
        await page.getByRole('group', { name: 'رسید منبع اعتبار' }).getByRole('button').filter({ hasText: result.receipt.number }).click();
        await page.waitForFunction(id => [...document.querySelector('select[aria-label="فاکتور مقصد اعتبار"]').options].some(o => o.value === String(id)), invoice.id);
        await chooseInvoice(page,invoice.id);
        await page.getByLabel(/^مبلغ/).last().fill('1');
        await page.getByLabel('مرجع رضایت یا درخواست مشتری', { exact: true }).fill('BROWSER-GROUP-ALLOCATION-CONSENT');
        await page.getByLabel('دلیل تخصیص', { exact: true }).fill('تخصیص صریح وجه قبض گروهی به تعهد مشتری');
        await clickPost(page, page.getByRole('button', { name: 'ارسال برای تأیید مستقل', exact: true }), '/api/customer-credit');
        const operation = row('SELECT MAX(id) id FROM customer_credit_operations WHERE customer_id=?', customer).id;
        check('Proposal does not settle an invoice before independent approval', row('SELECT paid FROM effective_invoices WHERE id=?', invoice.id).paid === 0);
        const review = await browser.newContext();
        await review.request.post(BASE + '/api/auth/login', { data: { email: reviewer.user.email, password }, headers: { origin: BASE } });
        await review.addCookies([{ name: 'repaid_branch', value: String(branch), url: BASE }]);
        const approved = await review.request.post(BASE + '/api/customer-credit', { data: { action: 'approve', id: operation }, headers: { origin: BASE, 'idempotency-key': 'approve-group-credit-' + stamp } });
        check('Independent reviewer approves the real source-bound allocation', approved.status() === 200);
        await page.reload({ waitUntil: 'networkidle' });
        await clickPost(page, page.getByRole('button', { name: 'ثبت قطعی در دفترکل', exact: true }), '/api/customer-credit');
        check('Allocation settles exactly 10 rial without another receipt', row('SELECT paid FROM effective_invoices WHERE id=?', invoice.id).paid === 10 && count('payments') === before + 1);
        await page.getByRole('button', { name: 'استرداد نقدی', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(/^مبلغ/).fill('0.5');
        await dialog.getByLabel('دلیل', { exact: true }).fill('باقی‌ماندهٔ وجه به مشتری تحویل داده شد');
        await dialog.getByLabel('مرجع سند یا رضایت', { exact: true }).fill('BROWSER-GROUP-REFUND-' + stamp);
        await dialog.getByRole('checkbox').check();
        await clickPost(page, dialog.getByRole('button', { name: 'ثبت وجه انجام‌شده', exact: true }), '/api/customer-credit');
        check('Refund preserves the original receipt and exact available credit', row('SELECT amount FROM payments WHERE id=?', result.receipt.id).amount === 15 && row('SELECT SUM(amount) n FROM refunds WHERE payment_id=?', result.receipt.id).n === 5 && require('../src/lib/customer-credit.ts').customerCreditSource(db, result.receipt.id).available === 0);
        await page.goto(BASE + '/repairs/group-receipt/' + gid, { waitUntil: 'networkidle' });
        check('Updated printout reconciles refund and allocated credit', (await page.getByRole('region', { name: 'دریافت نقدی گروه' }).innerText()).includes('۰ تومان'));
        check('Ledger proof remains valid', ledger.verifyLedger(db).valid);
        const foreign = await browser.newContext();
        await foreign.request.post(BASE + '/api/auth/login', { data: { email: 'group-foreign-' + stamp + '@test.local', password }, headers: { origin: BASE } });
        const denied = await foreign.request.get(BASE + '/repairs/group-receipt/' + gid);
        const deniedBody=await denied.text();
        fs.writeFileSync(out+'/branch-denial.json',JSON.stringify({status:denied.status(),leaked:deniedBody.includes('BROWSER-GROUP-CASH-'+stamp),notFound:deniedBody.includes('NEXT_HTTP_ERROR_FALLBACK;404')},null,2));
        // Next's documented streamed notFound keeps HTTP 200; assert its exact
        // 404 boundary and noindex marker as well as absence of private evidence.
        const streamed404=denied.status()===200&&deniedBody.includes('NEXT_HTTP_ERROR_FALLBACK;404')&&/name="robots" content="noindex"/.test(deniedBody);
        check('Another branch receives a not-found boundary without source evidence', (denied.status()===404||streamed404)&&!deniedBody.includes('BROWSER-GROUP-CASH-'+stamp));
        const limited = await browser.newContext();
        await limited.request.post(BASE + '/api/auth/login', { data: { email: 'group-staff-' + stamp + '@test.local', password }, headers: { origin: BASE } });
        const limitedPage = await limited.newPage();
        await limitedPage.goto(BASE + '/repairs/bulk', { waitUntil: 'networkidle' });
        check('Cash controls reflect actual receiving permission', await limitedPage.locator('#bulk-dep').isDisabled());
        check('No browser runtime errors', errors.length === 0);
        fs.writeFileSync(out + '/result.json', JSON.stringify({ checks: checks.length, passed: checks, captures, errors }, null, 2));
        console.log(JSON.stringify({ checks: checks.length, captures: captures.length, errors }));
    }
    finally {
        if (browser)
            await browser.close();
        db.close();
    }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
