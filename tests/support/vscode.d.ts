// Testing-only VS Code API shape; real builds use @types/vscode from npm.
declare module 'vscode' {
  export class Position { constructor(line:number,character:number); readonly line:number; readonly character:number; }
  export class Range { constructor(start:Position,end:Position); constructor(startLine:number,startCharacter:number,endLine:number,endCharacter:number); readonly start:Position; readonly end:Position; intersection(other:Range):Range|undefined; }
  export enum DiagnosticSeverity { Error=0,Warning=1,Information=2,Hint=3 }
  export class Diagnostic { constructor(range:Range,message:string,severity?:DiagnosticSeverity); source?:string; }
  export class CodeAction { constructor(title:string,kind?:CodeActionKind); edit?:WorkspaceEdit; command?:Command; }
  export class CodeActionKind { static QuickFix:CodeActionKind; }
  export class WorkspaceEdit { replace(uri:Uri,range:Range,newText:string):void; }
  export interface Command { command:string; title:string; arguments?:any[]; }
  export interface Uri { toString():string }
  export interface TextLine { text:string }
  export interface TextDocument { uri:Uri; fileName:string; version:number; lineCount:number; getText():string; lineAt(line:number):TextLine; offsetAt(p:Position):number; positionAt(offset:number):Position }
  export interface TextEditor { document:TextDocument }
  export interface Disposable { dispose():unknown }
  export interface ExtensionContext { subscriptions:Disposable[] }
  export interface CodeActionProvider { provideCodeActions(document:TextDocument,range:Range):CodeAction[] }
  export const window: { activeTextEditor:TextEditor|undefined; showInformationMessage(message:string,...args:any[]):any };
  export const languages: {createDiagnosticCollection(name:string):{set(uri:Uri, diagnostics:Diagnostic[]):void; delete(uri:Uri):void; dispose():void};registerCodeActionsProvider(selector:any,provider:CodeActionProvider,metadata:any):Disposable};
  export const commands: {registerCommand(command:string,fn:(...args:any[])=>any):Disposable};
  export const workspace: {onDidOpenTextDocument(cb:(doc:TextDocument)=>void):Disposable;onDidSaveTextDocument(cb:(doc:TextDocument)=>void):Disposable;onDidChangeTextDocument(cb:(event:{document:TextDocument})=>void):Disposable;onDidCloseTextDocument(cb:(doc:TextDocument)=>void):Disposable};
}
