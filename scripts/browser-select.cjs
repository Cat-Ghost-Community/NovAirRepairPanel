// Exercise the visible searchable picker while retaining native form-value assertions.
exports.choose = async function choose(page, selector, value) {
  const native = page.locator(`select${selector}`);
  const label = await native.evaluate((element, target) => Array.from(element.options).find(option => option.value === String(target))?.label, value);
  if (label === undefined) throw new Error(`Missing option ${value} in ${selector}`);
  await native.locator('xpath=following-sibling::button[1]').click();
  const popup = page.locator('.search-select-panel:popover-open');
  await popup.locator('input[type="search"]').fill(label);
  await popup.getByRole('option', { name: label || 'بدون انتخاب', exact: true }).click();
};
