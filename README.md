![FlakeGuard Detector Banner](./images/banner.png)

# FlakeGuard Detector

FlakeGuard Detector is a VS Code extension for Playwright tests.

It helps catch common flaky test patterns while you are writing code, instead of finding them later in CI.

---

## What problem this solves

Flaky tests are a common issue in test automation.

Small things like hard waits, long CSS selectors, or non-retrying checks often go unnoticed during development.  
They work sometimes, but fail randomly later.

FlakeGuard focuses on these patterns and highlights them early inside the editor.

---

## What it does

FlakeGuard scans Playwright test files and looks for patterns that usually lead to flaky behavior.

It currently detects:

- Hard waits using `waitForTimeout`
- Long or structure-based CSS selectors
- `nth-child` selectors
- Force clicks (`force: true`)
- Assertions that do not retry

---

## How it helps

- Shows warnings directly in the editor
- Explains why a pattern may be flaky
- Suggests safer alternatives
- Provides quick fixes
- Generates a simple file-level summary

---

## Example

### Before

```ts
await page.waitForTimeout(5000);

await page.locator('div > div > span > button').click();

expect(await button.isVisible()).toBe(true);

### After 

await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();

await page.getByRole('button', { name: 'Submit' }).click();

await expect(button).toBeVisible();

How to use
Install the extension
Open a Playwright test file (.spec.ts, .test.ts, .js)
FlakeGuard will automatically highlight risky patterns
Use:
Ctrl + . for Quick Fix
Hover to see explanation

Flakiness Summary

You can also see a quick summary for the current file.

Steps:

Open Command Palette (Ctrl + Shift + P)

Run:
    FlakeGuard: Show Flakiness Summary
This shows how many issues are present in the file.

Notes
FlakeGuard is focused on early detection inside the IDE.
It does not run tests or depend on test execution.
The goal is to catch common issues while writing code.

## License

MIT
