/**
 * FlakeGuard SafeFix: deterministic, evidence-gated Playwright suggestions.
 * No network calls or generated/placeholder locators.
 */
import * as ts from 'typescript';

export interface ContextFix {
  start: number;
  end: number;
  replacement: string;
  title: string;
  explanation: string;
  category: 'hard-wait' | 'non-retrying-assertion';
}

const locatorFactories = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder',
  'getByTestId', 'getByAltText', 'getByTitle'
]);
const locatorTransforms = new Set(['first', 'last', 'nth', 'filter', 'and', 'or']);
const autoWaitActions = new Set(['click', 'dblclick', 'fill', 'check', 'uncheck', 'selectOption', 'setChecked']);

function hasAwait(node: ts.Expression): node is ts.AwaitExpression {
  return ts.isAwaitExpression(node);
}

function isLocatorFactoryExpression(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
  const method = expression.expression.name.text;
  const receiver = expression.expression.expression;
  if (locatorFactories.has(method)) {
    return ts.isIdentifier(receiver) && receiver.text === 'page' || isLocatorFactoryExpression(receiver);
  }
  return locatorTransforms.has(method) && isLocatorFactoryExpression(receiver);
}

/** Only accept a simple immutable locator declared in the same statement list. */
function isKnownLocator(expression: ts.Expression, priorStatements: readonly ts.Statement[]): boolean {
  if (isLocatorFactoryExpression(expression)) return true;
  if (!ts.isIdentifier(expression)) return false;
  const name = expression.text;
  if (name === 'page') return false;
  // Local writes would make it unsafe to assume the variable still points to the same locator.
  for (const statement of priorStatements) {
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
      && ts.isIdentifier(statement.expression.left) && statement.expression.left.text === name) return false;
  }
  const matches = priorStatements.flatMap(stmt =>
    ts.isVariableStatement(stmt)
      ? stmt.declarationList.declarations.filter(d => ts.isIdentifier(d.name) && d.name.text === name)
      : []);
  if (matches.length !== 1) return false;
  const declaration = matches[0];
  const statement = declaration.parent.parent;
  if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) return false;
  return !!declaration.initializer && isLocatorFactoryExpression(declaration.initializer);
}

function isHardWait(expression: ts.Expression): boolean {
  if (!hasAwait(expression) || !ts.isCallExpression(expression.expression)) return false;
  const call = expression.expression;
  return ts.isPropertyAccessExpression(call.expression)
    && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === 'page'
    && call.expression.name.text === 'waitForTimeout'
    && call.arguments.length === 1 && ts.isNumericLiteral(call.arguments[0]);
}

function nextActionLocator(statement: ts.Statement, priorStatements: readonly ts.Statement[]): ts.Expression | undefined {
  if (!ts.isExpressionStatement(statement) || !hasAwait(statement.expression)) return undefined;
  const awaited = statement.expression.expression;
  if (!ts.isCallExpression(awaited) || !ts.isPropertyAccessExpression(awaited.expression)) return undefined;
  if (!autoWaitActions.has(awaited.expression.name.text)) return undefined;
  // A forced click bypasses some actionability checks, so do not claim it auto-waits.
  if (awaited.arguments.some(arg => ts.isObjectLiteralExpression(arg) &&
    arg.properties.some(p => ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'force' &&
      p.initializer.kind === ts.SyntaxKind.TrueKeyword))) return undefined;
  const receiver = awaited.expression.expression;
  return isKnownLocator(receiver, priorStatements) ? receiver : undefined;
}

function buildHardWaitFixes(source: ts.SourceFile, statements: readonly ts.Statement[], i: number): ContextFix[] {
  const current = statements[i];
  if (!ts.isExpressionStatement(current) || !isHardWait(current.expression) || i + 1 >= statements.length) return [];
  const next = statements[i + 1];
  // Never infer intent across comments or other intervening source content.
  const between = source.text.slice(current.end, next.getStart(source));
  if (between.trim() !== '') return [];
  const receiver = nextActionLocator(next, statements.slice(0, i));
  if (!receiver) return [];
  const target = receiver.getText(source);
  const semi = current.getText(source).trimEnd().endsWith(';') ? ';' : '';
  const shared = {
    start: current.getStart(source), end: current.getEnd(), category: 'hard-wait' as const
  };
  return [
    {
      ...shared,
      title: 'SafeFix: Replace with observed locator visibility wait',
      replacement: `await ${target}.waitFor({ state: 'visible' })${semi}`,
      explanation: `FlakeGuard found the next Playwright action uses ${target}. This replacement waits on that actual locator rather than a fixed timer. Review whether visibility is the correct condition.`
    },
    {
      ...shared,
      title: 'SafeFix: Remove hard wait (next action auto-waits)',
      replacement: '',
      explanation: `The next Playwright action on ${target} already performs actionability auto-waiting. Removing this delay may be enough; check whether it was intentionally waiting for some other application state.`
    }
  ];
}

function buildAssertionFix(source: ts.SourceFile, statement: ts.Statement, prior: readonly ts.Statement[]): ContextFix[] {
  if (!ts.isExpressionStatement(statement)) return [];
  const root = statement.expression;
  if (!ts.isCallExpression(root) || !ts.isPropertyAccessExpression(root.expression) || root.expression.name.text !== 'toBe') return [];
  if (root.arguments.length !== 1) return [];
  const expected = root.arguments[0];
  const innerExpect = root.expression.expression;
  if (!ts.isCallExpression(innerExpect) || !ts.isIdentifier(innerExpect.expression) || innerExpect.expression.text !== 'expect' || innerExpect.arguments.length !== 1) return [];
  const observed = innerExpect.arguments[0];
  if (!ts.isAwaitExpression(observed) || !ts.isCallExpression(observed.expression)) return [];
  const observedCall = observed.expression;
  if (!ts.isPropertyAccessExpression(observedCall.expression) || observedCall.arguments.length !== 0) return [];
  const locator = observedCall.expression.expression;
  if (!isKnownLocator(locator, prior)) return [];
  const kind = observedCall.expression.name.text;
  let matcher: string | undefined;
  let matcherArg = '';
  if (expected.kind === ts.SyntaxKind.TrueKeyword || expected.kind === ts.SyntaxKind.FalseKeyword) {
    const affirmative = expected.kind === ts.SyntaxKind.TrueKeyword;
    if (kind === 'isVisible') matcher = affirmative ? 'toBeVisible' : 'toBeHidden';
    if (kind === 'isEnabled') matcher = affirmative ? 'toBeEnabled' : 'toBeDisabled';
  } else if (kind === 'textContent' && ts.isStringLiteralLike(expected)) {
    matcher = 'toHaveText';
    matcherArg = expected.getText(source);
  }
  if (!matcher) return [];
  const semi = statement.getText(source).trimEnd().endsWith(';') ? ';' : '';
  return [{
    start: statement.getStart(source), end: statement.getEnd(),
    replacement: `await expect(${locator.getText(source)}).${matcher}(${matcherArg})${semi}`,
    title: 'SafeFix: Use locator-specific retrying assertion',
    explanation: `This changes a one-time ${kind}() check into a Playwright retrying assertion on the same locator. Review the expected test behavior.`,
    category: 'non-retrying-assertion'
  }];
}

/** Walk each lexical statement list separately so suggestions do not cross tests/blocks. */
export function suggestContextFixes(text: string, fileName = 'test.spec.ts'): ContextFix[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true,
    /\.jsx?$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  // While the user is typing unfinished code, avoid generating a potentially wrong edit.
  if (((source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []).length > 0) return [];
  const results: ContextFix[] = [];
  function visit(node: ts.Node): void {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node) || ts.isModuleBlock(node)) {
      const statements: readonly ts.Statement[] = node.statements;
      for (let i = 0; i < statements.length; i++) {
        results.push(...buildHardWaitFixes(source, statements, i));
        results.push(...buildAssertionFix(source, statements[i], statements.slice(0, i)));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return results;
}
