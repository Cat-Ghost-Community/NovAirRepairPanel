const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright-core');
const base = process.env.BASE_URL || 'http://127.0.0.1:3002';
const filename = path.resolve(process.env.E2E_DB || '');
if (process.env.FINANCIAL_BROWSER_MUTATIONS !== '1' || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)
    || !filename.startsWith(path.resolve('.freebuff') + path.sep)) throw new Error('Explicit local isolated financial browser fixture required');

(async () => {
  const db = new DatabaseSync(filename, { readOnly: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const evidence = { checks: [], screenshots: [], browserErrors: [] };
  const check = (name, pass) => { evidence.checks.push({ name, pass }); if (!pass) throw new Error(name); };
  try {
    const context = await browser.newContext({ locale: 'fa-IR', viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post(base + '/api/auth/login', { headers: { origin: base }, data: { email: 'owner@repaid.local', password: 'demo1234' } });
    if (!login.ok()) throw new Error('Fixture login failed');
    const post = async (url, body) => {
      const response = await context.request.post(base + url, { headers: { origin: base, 'idempotency-key': crypto.randomUUID() }, data: body });
      const data = await response.json();
      if (!response.ok()) throw new Error(`${url}: ${data.error}`);
      return data;
    };
    const customers = await (await context.request.get(base + '/api/customers?limit=1')).json();
    const customer = customers.customers[0].id;
    const invoice = await post('/api/invoices', { type: 'sale', customer_id: customer, confirm: true, client_key: crypto.randomUUID(), items: [{ kind: 'service', name: 'آزمون گردش مالی مرورگر', qty: 1, unit_price: 10000 }] });
    check('server uses the explicitly isolated fixture', Boolean(db.prepare('SELECT id FROM invoices WHERE id=? AND number=?').get(invoice.id, invoice.number)));
    const page = await context.newPage();
    page.on('pageerror', error => evidence.browserErrors.push(error.message));
    await page.goto(base + `/payments/new?invoice_id=${invoice.id}`, { waitUntil: 'networkidle' });
    await page.locator('#amt').fill('123'); // Fixture displays toman: 123 = 1230 IRR.
    let responseLost = false;
    await page.route('**/api/payments', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const result = await route.fetch();
      if (!result.ok()) throw new Error('Expected committed receipt before network loss');
      responseLost = true;
      return route.abort('connectionfailed');
    });
    await page.getByRole('button', { name: 'ثبت پرداخت', exact: true }).click();
    await page.getByText('نتیجهٔ عملیات دریافت نشد.', { exact: false }).first().waitFor();
    check('lost response is reported honestly in Persian', responseLost);
    check('committed receipt uses exact toman-to-rial conversion', db.prepare('SELECT amount FROM payments WHERE invoice_id=?').get(invoice.id)?.amount === 1230);
    await page.unroute('**/api/payments');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#amt').fill('123');
    await page.getByRole('button', { name: 'ثبت پرداخت', exact: true }).click();
    await page.waitForURL(base + `/invoices/${invoice.id}`);
    check('retry after reload does not create another receipt', db.prepare('SELECT COUNT(*) n FROM payments WHERE invoice_id=?').get(invoice.id)?.n === 1);
    await page.getByRole('button', { name: 'بازگشت وجه', exact: true }).first().click();
    await page.getByLabel('مبلغ بازگشت', { exact: true }).fill('invalid');
    await page.getByRole('button', { name: 'ثبت بازگشت وجه', exact: true }).click();
    await page.getByText('مبلغ بازگشت معتبر نیست.', { exact: true }).first().waitFor();
    check('invalid refund input is a Persian validation error, not a browser crash', evidence.browserErrors.length === 0);
    await page.getByLabel('مبلغ بازگشت', { exact: true }).fill('۱۰');
    await page.getByRole('button', { name: 'ثبت بازگشت وجه', exact: true }).click();
    await page.getByText('بازگشت وجه ثبت شد', { exact: true }).first().waitFor();
    check('Persian refund input uses the display unit', db.prepare('SELECT amount FROM refunds WHERE invoice_id=?').get(invoice.id)?.amount === 100);

    await page.goto(base + '/expenses/new', { waitUntil: 'networkidle' });
    await page.locator('#amt').fill('123');
    await page.locator('#desc').fill('financial-browser-proof');
    await page.getByRole('button', { name: 'ثبت هزینه', exact: true }).click();
    await page.waitForURL(base + '/expenses');
    check('expense form uses the same canonical unit', db.prepare("SELECT amount FROM expenses WHERE description='financial-browser-proof'").get()?.amount === 1230);

    const part = db.prepare(`SELECT p.id,p.name,p.price FROM parts p JOIN inventory_stock s ON s.part_id=p.id
      JOIN inventory_locations l ON l.id=s.location_id WHERE p.is_active=1 AND l.branch_id=1 AND s.qty>4 ORDER BY p.id LIMIT 1`).get();
    check('deterministic fixture tax is ten percent', db.prepare("SELECT value FROM settings WHERE key='tax_rate'").get()?.value === '10');
    await page.goto(base + '/pos', { waitUntil: 'networkidle' });
    await page.getByLabel('جستجوی کالا یا اسکن بارکد', { exact: true }).fill(part.name);
    await page.locator('button.card').filter({ hasText: part.name }).first().click();
    const saleResponse = page.waitForResponse(response => response.url() === base + '/api/sales' && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^ثبت فروش / }).click();
    const saleResult = await saleResponse;
    const sale = await saleResult.json();
    check('guest POS checkout persists a real sale and payment', saleResult.ok() && db.prepare('SELECT amount FROM payments WHERE sale_id=?').get(sale.id)?.amount === part.price + Math.round(part.price / 10));

    await page.goto(base + '/purchase-orders/new', { waitUntil: 'networkidle' });
    await page.locator('#sup').selectOption({ index: 1 });
    await page.locator('#ship').fill('12');
    await page.getByRole('button', { name: '+ افزودن قلم', exact: true }).click();
    await page.getByLabel('قطعه', { exact: true }).selectOption(String(part.id));
    await page.getByLabel('تعداد', { exact: true }).fill('2');
    await page.getByLabel('قیمت واحد', { exact: true }).fill('123');
    await page.getByLabel('یادداشت‌ها', { exact: true }).fill('financial-browser-purchase');
    await page.getByRole('button', { name: 'ذخیره و ارسال به تأمین‌کننده', exact: true }).click();
    await page.waitForURL(/\/purchase-orders\/\d+$/);
    const poId = Number(page.url().split('/').pop());
    const order = db.prepare('SELECT items_total,tax,shipping,total FROM purchase_orders WHERE id=?').get(poId);
    check('purchase form uses configured tax and canonical price/freight units', order.items_total === 2460 && order.tax === 246 && order.shipping === 120 && order.total === 2826);
    const stock = () => db.prepare('SELECT SUM(s.qty) quantity FROM inventory_stock s JOIN inventory_locations l ON l.id=s.location_id WHERE s.part_id=? AND l.branch_id=1').get(part.id).quantity;
    const beforeReceipt = stock();
    await page.getByRole('button', { name: 'دریافت کالا', exact: true }).click();
    const receiveResponse = page.waitForResponse(response => response.url() === base + `/api/purchase-orders/${poId}` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'تأیید دریافت', exact: true }).click();
    check('goods receipt updates physical branch stock', (await receiveResponse).ok() && stock() === beforeReceipt + 2);
    await page.goto(base + `/invoices/new?type=purchase&po=${poId}`, { waitUntil: 'networkidle' });
    check('source financial inputs are read-only', await page.getByLabel('جست‌وجوی کالا', { exact: true }).isDisabled() && await page.locator('#inv-disc').isDisabled());
    await page.getByRole('button', { name: 'ثبت بدون چاپ', exact: true }).click();
    await page.waitForURL(/\/invoices\/\d+$/);
    const purchaseInvoice = Number(page.url().split('/').pop());
    check('source purchase invoice preserves freight and tax without configured re-rounding', db.prepare('SELECT total FROM invoices WHERE id=?').get(purchaseInvoice)?.total === 2826);
    check('official purchase invoice never receipts goods twice', stock() === beforeReceipt + 2 && db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE ref_type='invoice' AND ref_id=?").get(purchaseInvoice)?.n === 0);

    await page.goto(base + '/parts/new', { waitUntil: 'networkidle' });
    await page.getByLabel('نام کالا', { exact: false }).fill('کالای مستقل آزمون مالی');
    await page.locator('#cat').fill('browser-finance');
    await page.locator('#pp').fill('123');
    await page.locator('#pr').fill('200');
    await page.locator('#oq').fill('3');
    await page.getByRole('button', { name: 'ایجاد کالا', exact: true }).click();
    await page.waitForURL(/\/parts\/\d+$/);
    const newPartId = Number(page.url().split('/').pop());
    const createdPart = db.prepare('SELECT price,purchase_price,avg_cost FROM parts WHERE id=?').get(newPartId);
    const newStock = () => db.prepare('SELECT SUM(qty) qty FROM inventory_stock WHERE part_id=?').get(newPartId).qty;
    check('catalogue and opening stock share one real canonical operation', createdPart.price === 2000 && createdPart.purchase_price === 1230 && createdPart.avg_cost === 1230 && newStock() === 3);
    await page.getByRole('button', { name: 'اصلاح موجودی', exact: true }).click();
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      const dialog = await page.getByRole('dialog', { name: 'اصلاح موجودی' }).evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
      });
      check(`stock cost dialog fits ${width}px`, dialog);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#mv-qty').fill('1');
    await page.locator('#mv-note').fill('ثبت رسید واقعی مرورگر');
    const movementResponse = page.waitForResponse(response => response.url() === base + `/api/parts/${newPartId}/stock` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'اعمال', exact: true }).click();
    check('manual receipt includes explicit real unit cost', (await movementResponse).ok() && newStock() === 4);

    await page.goto(base + '/inventory-tools', { waitUntil: 'networkidle' });
    await page.locator('#tr-part').selectOption(String(newPartId));
    await page.locator('#tr-qty').fill('1');
    const transferResponse = page.waitForResponse(response => response.url() === base + '/api/inventory/tools' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'انتقال', exact: true }).click();
    const transferResult = await transferResponse;
    const transfer = await transferResult.json();
    check('browser transfer conserves total stock and creates exactly two paired movements', transferResult.ok() && newStock() === 4 && db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE ref_type='inventory_transfer' AND ref_id=?").get(transfer.id)?.n === 2);

    fs.mkdirSync('.freebuff/financial-visual', { recursive: true });
    const repairId = db.prepare('SELECT id FROM repair_tickets WHERE branch_id=1 ORDER BY id LIMIT 1').get().id;
    const routes = ['/payments/new', '/expenses/new', '/checks', '/bank', '/finance', `/invoices/${invoice.id}`,
      '/pos', '/purchase-orders/new', `/purchase-orders/${poId}`, `/invoices/new?type=purchase&po=${poId}`,
      '/parts/new', `/parts/${newPartId}`, '/inventory-tools', '/repairs/quick', `/repairs/${repairId}`, '/invoices/new?type=repair'];
    for (const theme of ['light', 'dark']) {
      for (const route of routes) {
        await page.goto(base + route, { waitUntil: 'networkidle' });
        await page.evaluate(theme => {
          document.documentElement.classList.toggle('dark', theme === 'dark');
          localStorage.setItem('repaid-theme', theme);
        }, theme);
        for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(100);
          const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth,
            clippedValues: Array.from(document.querySelectorAll('.kpi-value')).filter(e => e.scrollWidth > e.clientWidth + 1).length,
            lang: document.documentElement.lang, direction: getComputedStyle(document.documentElement).direction }));
          const file = `.freebuff/financial-visual/${route.replace(/[^a-z0-9]/gi, '_')}-${theme}-${width}.png`;
          await page.screenshot({ path: file, fullPage: true });
          evidence.screenshots.push({ route, theme, width, overflow: layout.content > layout.width + 1, clippedValues: layout.clippedValues, rtl: layout.lang === 'fa' && layout.direction === 'rtl', file });
        }
      }
    }
    check('all changed financial pages fit the tested viewports', evidence.screenshots.every(s => !s.overflow));
    check('financial KPI values are not clipped inside their cards', evidence.screenshots.every(s => s.clippedValues === 0));
    check('Persian RTL on all captures', evidence.screenshots.every(s => s.rtl));
    check('no browser runtime errors', evidence.browserErrors.length === 0);
  } finally {
    fs.writeFileSync('.freebuff/financial-browser.json', JSON.stringify(evidence, null, 2));
    await browser.close(); db.close();
  }
  console.log(JSON.stringify({ checks: evidence.checks, screenshots: evidence.screenshots.length, errors: evidence.browserErrors.length }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
