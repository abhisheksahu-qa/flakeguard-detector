const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname, '..');
for (const file of ['extension','contextFixes']) {
  const source = fs.readFileSync(path.join(root,'src',file+'.ts'),'utf8');
  const generated = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  fs.mkdirSync(path.join(root,'out'),{recursive:true});
  fs.writeFileSync(path.join(root,'out',file+'.js'),generated);
}
let registeredProvider;
let diagnosticItems;
class Position { constructor(line, character){this.line=line;this.character=character;} }
class Range {
  constructor(a,b,c,d) { this.start=typeof a==='number'?new Position(a,b):a;this.end=typeof a==='number'?new Position(c,d):b; }
  intersection(r){return this.end.line < r.start.line || this.start.line > r.end.line ? undefined : this;}
}
class Diagnostic {constructor(range,message,severity){this.range=range;this.message=message;this.severity=severity;}}
class CodeAction {constructor(title,kind){this.title=title;this.kind=kind;}}
class WorkspaceEdit {constructor(){this.ops=[];}replace(uri,range,replacement){this.ops.push({uri,range,replacement});}}
const vscode = {
  Position,Range,Diagnostic,CodeAction,WorkspaceEdit,
  DiagnosticSeverity:{Warning:1,Information:2},CodeActionKind:{QuickFix:'quickfix'},
  window:{activeTextEditor:undefined,showInformationMessage:()=>{}},
  commands:{registerCommand:()=>({dispose(){}})},
  languages:{createDiagnosticCollection:()=>({set:(_uri,items)=>{diagnosticItems=items;},delete(){},dispose(){}}),registerCodeActionsProvider:(_s,provider)=>{registeredProvider=provider;return {dispose(){}};}},
  workspace:Object.fromEntries(['onDidOpenTextDocument','onDidSaveTextDocument','onDidChangeTextDocument','onDidCloseTextDocument'].map(k=>[k,()=>({dispose(){}})]))
};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){return request==='vscode'?vscode:originalLoad.call(this,request,parent,isMain);};
const extension=require('../out/extension');
Module._load=originalLoad;
const code=`import { test, expect } from '@playwright/test';
test('demo', async ({ page }) => {
  const button = page.getByRole('button', {name: 'Submit'});
  await page.waitForTimeout(5000);
  await button.click();
  expect(await button.isVisible()).toBe(true);
  await page.locator('main > div > button').click();
});`;
function document(text){
  const lines=text.split('\n');
  return {fileName:'demo.spec.ts', uri:{toString:()=> 'file:///demo.spec.ts'}, version:1,lineCount:lines.length,
    getText:()=>text,lineAt:n=>({text:lines[n]}),
    offsetAt:pos=>lines.slice(0,pos.line).reduce((s,x)=>s+x.length+1,0)+pos.character,
    positionAt(offset){let line=0;while(line<lines.length-1 && offset>lines[line].length){offset-=lines[line].length+1;line++;}return new Position(line,offset);}
  };
}
const doc=document(code);
vscode.window.activeTextEditor={document:doc};
extension.activate({subscriptions:[]});
assert.equal(diagnosticItems.length,3);
const waitActions=registeredProvider.provideCodeActions(doc,new Range(3,2,3,30));
assert.ok(waitActions.some(a=>a.title.includes('observed locator')));
assert.ok(waitActions.some(a=>a.title.includes('Remove hard wait')));
assert.equal(waitActions.filter(a=>a.title.startsWith('SafeFix:')).length,2);
const assertionActions=registeredProvider.provideCodeActions(doc,new Range(5,2,5,30));
assert.equal(assertionActions.filter(a=>a.title.startsWith('SafeFix:')).length,1);
const cssActions=registeredProvider.provideCodeActions(doc,new Range(6,2,6,50));
assert.equal(cssActions.filter(a=>a.title.startsWith('SafeFix:')).length,0);
assert.ok(cssActions.some(a=>a.title.includes('Explain')));
console.log('PASS: VS Code simulated integration (diagnostics, context fixes, safe fallback)');
