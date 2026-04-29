![FlakeGuard Detector Banner](./images/banner.png)

# FlakeGuard Detector

FlakeGuard Detector is a VS Code extension for Playwright tests.

It focuses on identifying common patterns that lead to flaky tests while writing code, such as hard waits, fragile selectors, nth-child usage, force clicks, and non-retrying assertions.

These issues often go unnoticed during development but cause failures later in CI. FlakeGuard highlights them early in the editor and suggests safer alternatives.

---

## What problem this solves

Flaky tests are a common issue in test automation.

Patterns like hard waits, fragile selectors, or non-retrying checks often pass locally but fail in CI.

FlakeGuard highlights these patterns early, before they become debugging issues.

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

---

## What makes this different

FlakeGuard works directly inside the editor and focuses on detecting flaky patterns while writing test code.

It does not rely on running tests or analyzing failures later. The goal is to catch issues early, before they become CI failures.

---

## How to use

1. Install the extension  
2. Open a Playwright test file (`.spec.ts`, `.test.ts`, `.js`)  
3. FlakeGuard highlights risky patterns automatically  
4. Use:
   - `Ctrl + .` for Quick Fix  
   - Hover to see explanation  

---

## Flakiness summary

FlakeGuard provides a simple summary of issues in a file.

Use command palette:
FlakeGuard: Show Flakiness Summary

This helps quickly understand how many potential flaky patterns exist in a test file.

---

## Notes
FlakeGuard is focused on early detection inside the IDE.
It does not run tests or depend on test execution.
The goal is to catch common issues while writing code.

## License

MIT
