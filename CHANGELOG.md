# Changelog

## 0.0.4 — Context-Aware SafeFix

### Added
- Context-aware Quick Fix suggestions for Playwright hard waits.
- Detection of existing locators for safer replacements.
- Option to remove unnecessary hard waits before auto-waiting actions.
- Auto-retrying assertion fixes using existing locators.
- Safety checks to avoid generating placeholder locators.
- Automated tests for SafeFix behavior.

### Improved
- More reliable Quick Fix suggestions.
- Clearer explanations for flaky test patterns.
- Existing FlakeGuard detections and summary remain available.