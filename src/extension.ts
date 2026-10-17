import * as vscode from 'vscode';
import { suggestContextFixes, ContextFix } from './contextFixes';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('flakeguard');

interface FlakeFinding {
  range: vscode.Range;
  explanation: string;
  fixes: { title: string; replacement: string; range: vscode.Range }[];
}

interface FlakeSummary {
  hardWaits: number;
  fragileSelectors: number;
  nthChildSelectors: number;
  forceClicks: number;
  nonRetryAssertions: number;
}

const findings = new Map<string, { version: number; items: FlakeFinding[] }>();
const summaries = new Map<string, FlakeSummary>();

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.commands.registerCommand('flakeguard.scanFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return void vscode.window.showInformationMessage('Open a Playwright test file first.');
      scanDocument(editor.document);
      vscode.window.showInformationMessage('FlakeGuard scan completed.');
    }),
    vscode.commands.registerCommand('flakeguard.showSummary', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return void vscode.window.showInformationMessage('Open a Playwright test file first.');
      scanDocument(editor.document);
      showSummary(editor.document);
    }),
    vscode.commands.registerCommand('flakeguard.explainFix', (message: string) => {
      vscode.window.showInformationMessage(message, { modal: true });
    }),
    vscode.workspace.onDidOpenTextDocument(scanDocument),
    vscode.workspace.onDidSaveTextDocument(scanDocument),
    vscode.workspace.onDidChangeTextDocument(event => scanDocument(event.document)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      diagnosticCollection.delete(doc.uri);
      findings.delete(doc.uri.toString());
      summaries.delete(doc.uri.toString());
    }),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'typescript' }, { language: 'javascript' }],
      new FlakeGuardCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  if (vscode.window.activeTextEditor) scanDocument(vscode.window.activeTextEditor.document);
}

function isPlaywrightTestFile(doc: vscode.TextDocument): boolean {
  return /\.(spec|test)\.[jt]s$/i.test(doc.fileName);
}

function scanDocument(doc: vscode.TextDocument): void {
  const uri = doc.uri.toString();
  if (!isPlaywrightTestFile(doc)) {
    diagnosticCollection.delete(doc.uri);
    findings.delete(uri);
    summaries.delete(uri);
    return;
  }
  const diagnostics: vscode.Diagnostic[] = [];
  const fileFindings: FlakeFinding[] = [];
  const summary: FlakeSummary = {
    hardWaits: 0, fragileSelectors: 0, nthChildSelectors: 0,
    forceClicks: 0, nonRetryAssertions: 0
  };
  const source = doc.getText();
  const contextFixes = suggestContextFixes(source, doc.fileName);

  function report(lineNumber: number, text: string, match: string, message: string,
    explanation: string, severity: vscode.DiagnosticSeverity,
    category: keyof FlakeSummary, startSearchAt = 0): void {
    const index = text.indexOf(match, startSearchAt);
    if (index < 0) return;
    const range = new vscode.Range(lineNumber, index, lineNumber, index + match.length);
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'FlakeGuard Detector';
    diagnostics.push(diagnostic);
    summary[category]++;
    const startOffset = doc.offsetAt(range.start);
    const endOffset = doc.offsetAt(range.end);
    const related = contextFixes.filter(f =>
      (category === 'hardWaits' && f.category === 'hard-wait' ||
       category === 'nonRetryAssertions' && f.category === 'non-retrying-assertion')
      && f.start <= startOffset && f.end >= endOffset);
    fileFindings.push({
      range,
      explanation: related.length > 0 ? `${explanation}\n\n${related[0].explanation}` : explanation,
      fixes: related.map((fix: ContextFix) => ({
        title: fix.title, replacement: fix.replacement,
        range: new vscode.Range(doc.positionAt(fix.start), doc.positionAt(fix.end))
      }))
    });
  }

  for (let index = 0; index < doc.lineCount; index++) {
    const text = doc.lineAt(index).text;
    const wait = /await\s+page\.waitForTimeout\((\d+)\);?/g;
    for (const match of text.matchAll(wait)) {
      report(index, text, match[0],
        'FlakeGuard: Hard wait found. Time-based waits can cause flaky tests.',
        'Fixed delays do not prove the application is ready. SafeFix appears only when FlakeGuard can identify the next locator action.',
        vscode.DiagnosticSeverity.Warning, 'hardWaits', match.index);
    }
    const selectors = /page\.locator\((['"`])([^'"`]+)\1\)/g;
    for (const match of text.matchAll(selectors)) {
      const selector = match[2];
      if (selector.includes('nth-child')) {
        report(index, text, match[0],
          'FlakeGuard: nth-child selector found. Element position can change.',
          'Choose a role, label, or test ID using the actual application markup. FlakeGuard will not invent one.',
          vscode.DiagnosticSeverity.Warning, 'nthChildSelectors', match.index);
      } else if (selector.includes('>') || selector.trim().split(/\s+/).length >= 3 || selector.split('.').length >= 4) {
        report(index, text, match[0],
          'FlakeGuard: Fragile selector found. Long CSS selectors depend on page structure.',
          'Prefer a semantic locator after checking the actual page. A safe automatic replacement cannot be inferred from CSS alone.',
          vscode.DiagnosticSeverity.Warning, 'fragileSelectors', match.index);
      }
    }
    const force = /\.click\(\{\s*force:\s*true\s*\}\)/g;
    for (const match of text.matchAll(force)) {
      report(index, text, match[0],
        'FlakeGuard: Force click found. This may hide actionability issues.',
        'Review whether force is necessary. Automatically removing it could change test behavior.',
        vscode.DiagnosticSeverity.Warning, 'forceClicks', match.index);
    }
    const nonRetry = /expect\(\s*await\s+.+?\.(?:isVisible|isEnabled|textContent)\(\)\s*\)\.toBe\(/g;
    for (const match of text.matchAll(nonRetry)) {
      report(index, text, match[0],
        'FlakeGuard: Non-retrying assertion found. Prefer a locator assertion.',
        'One-time state checks do not retry. SafeFix can convert supported assertions while retaining the original locator.',
        vscode.DiagnosticSeverity.Information, 'nonRetryAssertions', match.index);
    }
  }
  diagnosticCollection.set(doc.uri, diagnostics);
  findings.set(uri, { version: doc.version, items: fileFindings });
  summaries.set(uri, summary);
}

function showSummary(document: vscode.TextDocument): void {
  const summary = summaries.get(document.uri.toString());
  if (!summary) return void vscode.window.showInformationMessage('No FlakeGuard summary found for this file.');
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  const message = `FlakeGuard Summary\n\nTotal findings: ${total}\n\n` +
    `Hard waits: ${summary.hardWaits}\nFragile selectors: ${summary.fragileSelectors}\n` +
    `nth-child selectors: ${summary.nthChildSelectors}\nForce clicks: ${summary.forceClicks}\n` +
    `Non-retrying assertions: ${summary.nonRetryAssertions}`;
  vscode.window.showInformationMessage(message, { modal: true });
}

class FlakeGuardCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const cached = findings.get(document.uri.toString());
    if (!cached || cached.version !== document.version) return [];
    const result: vscode.CodeAction[] = [];
    for (const finding of cached.items) {
      if (!finding.range.intersection(range)) continue;
      for (const fix of finding.fixes) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, fix.range, fix.replacement);
        result.push(action);
      }
      const explanation = new vscode.CodeAction('FlakeGuard: Explain why this is flaky', vscode.CodeActionKind.QuickFix);
      explanation.command = {
        command: 'flakeguard.explainFix', title: 'Explain why this is flaky',
        arguments: [finding.explanation]
      };
      result.push(explanation);
    }
    return result;
  }
}

export function deactivate() {
  diagnosticCollection.dispose();
}
