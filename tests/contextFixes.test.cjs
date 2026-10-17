const assert = require('node:assert/strict');
const { suggestContextFixes } = require('../out/contextFixes');
let checks = 0;
function check(label, code, expectedTitles, expectedReplacements) {
  const fixes = suggestContextFixes(code, 'demo.spec.ts');
  assert.deepEqual(fixes.map(x => x.title), expectedTitles, label + ' titles');
  if (expectedReplacements) assert.deepEqual(fixes.map(x => x.replacement), expectedReplacements, label + ' replacement');
  checks++;
}
check('known locator, context-aware fixes', `
import {test, expect} from '@playwright/test';
test('sample', async ({page}) => {
  const loginButton = page.getByRole('button', { name: 'Login' });
  await page.waitForTimeout(5000);
  await loginButton.click();
});`,
 ['SafeFix: Replace with observed locator visibility wait', 'SafeFix: Remove hard wait (next action auto-waits)'],
 [`await loginButton.waitFor({ state: 'visible' });`, '']);
check('unknown intent gives no edits', `
await page.waitForTimeout(5000);
await page.goto('https://example.org');`, []);
check('unknown target gives no edits', `
await page.waitForTimeout(5000);
await unknown.click();`, []);
check('separate scope does not leak locator', `
const button = page.getByRole('button',{name:'Outside'});
test('x',async () => {
await page.waitForTimeout(5000);
await button.click();
});`, []);
check('safe inline locator', `
await page.waitForTimeout(100);
await page.getByTestId('save').click();`,
 ['SafeFix: Replace with observed locator visibility wait', 'SafeFix: Remove hard wait (next action auto-waits)'],
 [`await page.getByTestId('save').waitFor({ state: 'visible' });`, '']);
check('comment prevents inferred fix', `
const button = page.getByRole('button',{name:'Go'});
await page.waitForTimeout(100);
// deliberately waiting for animation to finish
await button.click();`, []);
check('handles non retrying true', `
const submit = page.getByRole('button', { name: 'Submit' });
expect(await submit.isVisible()).toBe(true);`,
 ['SafeFix: Use locator-specific retrying assertion'],
 ['await expect(submit).toBeVisible();']);
check('handles non retrying false', `
const submit = page.locator('#submit');
expect(await submit.isEnabled()).toBe(false);`,
 ['SafeFix: Use locator-specific retrying assertion'],
 ['await expect(submit).toBeDisabled();']);
check('handles text assertion', `
const status = page.getByTestId('status');
expect(await status.textContent()).toBe('Ready');`,
 ['SafeFix: Use locator-specific retrying assertion'],
 [`await expect(status).toHaveText('Ready');`]);
check('unsupported unknown style does not create fix', `
const submit = page.locator('#submit');
expect(await submit.isVisible()).not.toBe(true);`, []);
check('same variable reassigned no edit', `
let submit = page.locator('#submit');
await page.waitForTimeout(20);
await submit.click();`, []);
check('incomplete syntax suppresses fix', `
const submit = page.getByRole('button', {
await page.waitForTimeout(20);
await submit.click();`, []);
check('forced click must not be treated as auto wait', `
const button = page.locator('#submit');
await page.waitForTimeout(1000);
await button.click({force:true});`, []);

console.log(`PASS: ${checks} SafeFix behavior checks`);
