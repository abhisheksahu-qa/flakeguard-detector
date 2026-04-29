import * as vscode from 'vscode';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('flakeguard');

interface FlakeFix {
  range: vscode.Range;
  replacement: string;
  title: string;
  explanation: string;
}

interface FlakeSummary {
  hardWaits: number;
  fragileSelectors: number;
  nthChildSelectors: number;
  forceClicks: number;
  nonRetryAssertions: number;
}

const fixes = new Map<string, FlakeFix[]>();
const summaries = new Map<string, FlakeSummary>();

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(diagnosticCollection);

  const scanCommand = vscode.commands.registerCommand('flakeguard.scanFile', () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showInformationMessage('Open a Playwright test file first.');
      return;
    }

    scanDocument(editor.document);
    vscode.window.showInformationMessage('FlakeGuard scan completed.');
  });

  const summaryCommand = vscode.commands.registerCommand('flakeguard.showSummary', () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showInformationMessage('Open a Playwright test file first.');
      return;
    }

    scanDocument(editor.document);
    showSummary(editor.document);
  });

  const explainCommand = vscode.commands.registerCommand('flakeguard.explainFix', (message: string) => {
    vscode.window.showInformationMessage(message, { modal: true });
  });

  context.subscriptions.push(scanCommand, summaryCommand, explainCommand);

  if (vscode.window.activeTextEditor) {
    scanDocument(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scanDocument),
    vscode.workspace.onDidSaveTextDocument(scanDocument),
    vscode.workspace.onDidChangeTextDocument(event => scanDocument(event.document)),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'typescript' }, { language: 'javascript' }],
      new FlakeGuardCodeActionProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
      }
    )
  );
}

function scanDocument(document: vscode.TextDocument) {
  if (!isPlaywrightTestFile(document)) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const documentFixes: FlakeFix[] = [];

  const summary: FlakeSummary = {
    hardWaits: 0,
    fragileSelectors: 0,
    nthChildSelectors: 0,
    forceClicks: 0,
    nonRetryAssertions: 0
  };

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const line = document.lineAt(lineIndex);
    const text = line.text;

    detectWaitForTimeout(lineIndex, text, diagnostics, documentFixes, summary);
    detectNthChildSelector(lineIndex, text, diagnostics, documentFixes, summary);
    detectFragileSelector(lineIndex, text, diagnostics, documentFixes, summary);
    detectForceClick(lineIndex, text, diagnostics, documentFixes, summary);
    detectNonRetryAssertion(lineIndex, text, diagnostics, documentFixes, summary);
  }

  diagnosticCollection.set(document.uri, diagnostics);
  fixes.set(document.uri.toString(), documentFixes);
  summaries.set(document.uri.toString(), summary);
}

function isPlaywrightTestFile(document: vscode.TextDocument): boolean {
  const fileName = document.fileName.toLowerCase();

  return (
    fileName.endsWith('.spec.ts') ||
    fileName.endsWith('.test.ts') ||
    fileName.endsWith('.spec.js') ||
    fileName.endsWith('.test.js')
  );
}

function addDiagnostic(
  lineIndex: number,
  text: string,
  matchedText: string,
  message: string,
  severity: vscode.DiagnosticSeverity,
  diagnostics: vscode.Diagnostic[],
  documentFixes: FlakeFix[],
  fixTitle: string,
  replacement: string,
  explanation: string
) {
  const start = text.indexOf(matchedText);

  if (start < 0) {
    return;
  }

  const end = start + matchedText.length;
  const range = new vscode.Range(lineIndex, start, lineIndex, end);

  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = 'FlakeGuard Detector';

  diagnostics.push(diagnostic);

  documentFixes.push({
    range,
    replacement,
    title: fixTitle,
    explanation
  });
}

function detectWaitForTimeout(
  lineIndex: number,
  text: string,
  diagnostics: vscode.Diagnostic[],
  documentFixes: FlakeFix[],
  summary: FlakeSummary
) {
  const match = text.match(/await\s+page\.waitForTimeout\((\d+)\);?/);

  if (!match) {
    return;
  }

  summary.hardWaits++;

  addDiagnostic(
    lineIndex,
    text,
    match[0],
    'FlakeGuard: Hard wait found. Time-based waits can make Playwright tests flaky.',
    vscode.DiagnosticSeverity.Warning,
    diagnostics,
    documentFixes,
    'Replace hard wait with web-first assertion',
    "await expect(page.getByRole('button', { name: 'Replace with visible text' })).toBeVisible();",
    'This test waits for time instead of waiting for the page to be ready. A condition-based assertion is safer because it waits for the actual element or state.'
  );
}

function detectFragileSelector(
  lineIndex: number,
  text: string,
  diagnostics: vscode.Diagnostic[],
  documentFixes: FlakeFix[],
  summary: FlakeSummary
) {
  const match = text.match(/page\.locator\(['"`]([^'"`]+)['"`]\)/);

  if (!match) {
    return;
  }

  const selector = match[1];

  if (selector.includes('nth-child')) {
    return;
  }

  const isFragile =
    selector.includes('>') ||
    selector.split(' ').length >= 3 ||
    selector.split('.').length >= 4;

  if (!isFragile) {
    return;
  }

  summary.fragileSelectors++;

  addDiagnostic(
    lineIndex,
    text,
    match[0],
    'FlakeGuard: Fragile selector found. Long CSS selectors can break when the page structure changes.',
    vscode.DiagnosticSeverity.Warning,
    diagnostics,
    documentFixes,
    'Replace with role-based locator',
    "page.getByRole('button', { name: 'Replace with visible text' })",
    'This selector depends on page structure. Prefer role, label, text, or test id based locators because they are easier to read and more stable.'
  );
}

function detectNthChildSelector(
  lineIndex: number,
  text: string,
  diagnostics: vscode.Diagnostic[],
  documentFixes: FlakeFix[],
  summary: FlakeSummary
) {
  const match = text.match(/page\.locator\(['"`]([^'"`]*nth-child[^'"`]*)['"`]\)/);

  if (!match) {
    return;
  }

  summary.nthChildSelectors++;

  addDiagnostic(
    lineIndex,
    text,
    match[0],
    'FlakeGuard: nth-child selector found. Position-based selectors are commonly flaky.',
    vscode.DiagnosticSeverity.Warning,
    diagnostics,
    documentFixes,
    'Replace nth-child with test id locator',
    "page.getByTestId('replace-with-testid')",
    'nth-child depends on element position. If the page adds or removes an item, the test may click the wrong element.'
  );
}

function detectForceClick(
  lineIndex: number,
  text: string,
  diagnostics: vscode.Diagnostic[],
  documentFixes: FlakeFix[],
  summary: FlakeSummary
) {
  const match = text.match(/\.click\(\{\s*force:\s*true\s*\}\)/);

  if (!match) {
    return;
  }

  summary.forceClicks++;

  addDiagnostic(
    lineIndex,
    text,
    match[0],
    'FlakeGuard: Force click found. This can hide visibility or timing issues.',
    vscode.DiagnosticSeverity.Warning,
    diagnostics,
    documentFixes,
    'Remove force click',
    '.click()',
    'force: true skips Playwright actionability checks. It can hide real issues where the element is covered, disabled, or not ready.'
  );
}

function detectNonRetryAssertion(
  lineIndex: number,
  text: string,
  diagnostics: vscode.Diagnostic[],
  documentFixes: FlakeFix[],
  summary: FlakeSummary
) {
  const match = text.match(/expect\((await\s+)?(.+?)\.(isVisible|isEnabled|textContent)\(\)\)\.toBe/);

  if (!match) {
    return;
  }

  summary.nonRetryAssertions++;

  addDiagnostic(
    lineIndex,
    text,
    match[0],
    'FlakeGuard: Non-retrying assertion found. Prefer Playwright web-first assertions.',
    vscode.DiagnosticSeverity.Information,
    diagnostics,
    documentFixes,
    'Use auto-retrying Playwright assertion',
    'await expect(locator).toBeVisible();',
    'This check reads the current state only once. Playwright web-first assertions retry for a short time, which helps reduce flaky failures.'
  );
}

function showSummary(document: vscode.TextDocument) {
  const summary = summaries.get(document.uri.toString());

  if (!summary) {
    vscode.window.showInformationMessage('No FlakeGuard summary found for this file.');
    return;
  }

  const total =
    summary.hardWaits +
    summary.fragileSelectors +
    summary.nthChildSelectors +
    summary.forceClicks +
    summary.nonRetryAssertions;

  const message =
    `FlakeGuard Summary\n\n` +
    `Total findings: ${total}\n\n` +
    `Hard waits: ${summary.hardWaits}\n` +
    `Fragile selectors: ${summary.fragileSelectors}\n` +
    `nth-child selectors: ${summary.nthChildSelectors}\n` +
    `Force clicks: ${summary.forceClicks}\n` +
    `Non-retrying assertions: ${summary.nonRetryAssertions}`;

  vscode.window.showInformationMessage(message, { modal: true });
}

class FlakeGuardCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.CodeAction[] {
    const documentFixes = fixes.get(document.uri.toString()) || [];
    const matchingFixes = documentFixes.filter(fix => fix.range.intersection(range));

    const actions: vscode.CodeAction[] = [];

    for (const fix of matchingFixes) {
      const quickFix = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
      quickFix.edit = new vscode.WorkspaceEdit();
      quickFix.edit.replace(document.uri, fix.range, fix.replacement);
      actions.push(quickFix);

      const explainFix = new vscode.CodeAction('Explain why this is flaky', vscode.CodeActionKind.QuickFix);
      explainFix.command = {
        command: 'flakeguard.explainFix',
        title: 'Explain why this is flaky',
        arguments: [fix.explanation]
      };
      actions.push(explainFix);
    }

    return actions;
  }
}

export function deactivate() {
  diagnosticCollection.dispose();
}