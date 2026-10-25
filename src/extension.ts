import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { addNoteArea, loadSource, permissionFlags, resolvePaper, Align, PAPER_SIZES, SourceEncryptedError, WrongPasswordError } from './note';
import type { PDFDocument } from '@cantoo/pdf-lib';

const CONVERTER_ID = 'leekh.ipynb-pdf-converter';
const SUPPORTED = ['.pdf', '.ipynb', '.md'];

// The converter's API (its activate() return value); see ipynb-pdf-converter/src/extension.ts.
interface ConverterApi {
  apiVersion: number;
  convertToPdfBytes(request: {
    filePath: string;
    overrides?: Record<string, unknown>;
    token?: vscode.CancellationToken;
    onProgress?: (message: string, fraction: number) => void;
  }): Promise<Uint8Array>;
}

// Teacher mode marks (nb_convert.py --ssam), drawn in place of the header text.
type Mark = 'ho' | 'ju';
const MARK_IMAGES: Record<Mark, string> = {
  ho: 'https://data.hossam.kr/itwill-ho.png',
  ju: 'https://data.hossam.kr/itwill-ju.png',
};
const MARK_WIDTH = 100;

const ALIGNMENTS = ['left', 'center', 'right'] as const;
const PERMISSIONS = ['print', 'modify', 'copy', 'annot-forms'] as const;
const LAYOUT_MODES = ['note', 'feedback'] as const;

interface Settings {
  paperSize: string;
  layoutMode: (typeof LAYOUT_MODES)[number];
  feedbackBannerImage: string;
  lineGap: number;
  headerText: string;
  footerText: string;
  headerAlign: Align;
  footerAlign: Align;
  headerFooterFontSize: number;
  outputDirectory: string;
  outputFileName: string;
  openAfterConvert: boolean;
  pdfPermissions: string[];
  ownerPassword: string;
  teacherMode: boolean;
}

function defaultSettings(): Settings {
  return {
    paperSize: 'original',
    layoutMode: 'note',
    feedbackBannerImage: '',
    lineGap: 18,
    headerText: '{file}',
    footerText: '{page} / {total}',
    headerAlign: 'left',
    footerAlign: 'right',
    headerFooterFontSize: 10,
    outputDirectory: '',
    outputFileName: '{name}_note',
    openAfterConvert: false,
    pdfPermissions: ['annot-forms'],
    ownerPassword: '',
    teacherMode: false,
  };
}

function readSettings(config: vscode.WorkspaceConfiguration): Settings {
  const d = defaultSettings();
  const str = (key: keyof Settings): string => {
    const value = config.get<unknown>(key, d[key]);
    return typeof value === 'string' ? value : String(d[key]);
  };
  const num = (key: keyof Settings, min: number, max: number): number => {
    const value = Number(config.get<unknown>(key, d[key]));
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : (d[key] as number)));
  };
  const pick = <T extends string>(key: keyof Settings, allowed: readonly T[]): T => {
    const value = str(key);
    return (allowed as readonly string[]).includes(value) ? (value as T) : (d[key] as T);
  };
  const permissions = config.get<unknown>('pdfPermissions', d.pdfPermissions);
  return {
    paperSize: str('paperSize'),
    layoutMode: pick('layoutMode', LAYOUT_MODES),
    feedbackBannerImage: str('feedbackBannerImage').trim(),
    lineGap: num('lineGap', 6, 60),
    headerText: str('headerText'),
    footerText: str('footerText'),
    headerAlign: pick('headerAlign', ALIGNMENTS),
    footerAlign: pick('footerAlign', ALIGNMENTS),
    headerFooterFontSize: num('headerFooterFontSize', 6, 24),
    outputDirectory: str('outputDirectory').trim(),
    outputFileName: str('outputFileName').trim() || d.outputFileName,
    openAfterConvert: Boolean(config.get<unknown>('openAfterConvert', false)),
    pdfPermissions: Array.isArray(permissions)
      ? permissions.map(String).filter((p) => (PERMISSIONS as readonly string[]).includes(p))
      : d.pdfPermissions,
    ownerPassword: str('ownerPassword'),
    teacherMode: Boolean(config.get<unknown>('teacherMode', false)),
  };
}

let outputChannel: vscode.OutputChannel;
let fontCache: Uint8Array | undefined;

// Thrown when the user dismisses a prompt; reported like a cancellation.
class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

const COMMANDS: { id: string; withPassword: boolean; mark?: Mark }[] = [
  { id: 'pdf2note.addNotes', withPassword: false },
  { id: 'pdf2note.addNotesWithPassword', withPassword: true },
  { id: 'pdf2note.addNotesHossam', withPassword: false, mark: 'ho' },
  { id: 'pdf2note.addNotesHossamWithPassword', withPassword: true, mark: 'ho' },
  { id: 'pdf2note.addNotesJussam', withPassword: false, mark: 'ju' },
  { id: 'pdf2note.addNotesJussamWithPassword', withPassword: true, mark: 'ju' },
];

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('PDF2Note');
  for (const { id, withPassword, mark } of COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (arg?: unknown) => {
        // Explorer/editor menus pass the file Uri; notebook cell menus pass a
        // cell context instead, so fall back to the active tab's file.
        const target = arg instanceof vscode.Uri ? arg : resolveActiveUri();
        if (!target || !SUPPORTED.includes(path.extname(target.fsPath).toLowerCase())) {
          vscode.window.showErrorMessage('Please select a .pdf, .ipynb or .md file');
          return;
        }
        const password = withPassword ? await resolvePassword() : undefined;
        if (withPassword && password === undefined) {
          return; // prompt dismissed
        }
        await run(context, target.fsPath, password, mark);
      })
    );
  }
}

function resolveActiveUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  return input?.uri instanceof vscode.Uri ? input.uri : vscode.window.activeTextEditor?.document.uri;
}

// Same rule as ipynb-pdf-converter: the configured default, else a prompt.
async function resolvePassword(): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration('pdf2note').get<string>('pdfPassword', '');
  if (configured) {
    return configured;
  }
  return vscode.window.showInputBox({
    title: 'PDF Password',
    prompt: 'No default password is set (pdf2note.pdfPassword). Enter a password for this PDF.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value ? undefined : 'Password cannot be empty'),
  });
}

async function run(
  context: vscode.ExtensionContext,
  filePath: string,
  password: string | undefined,
  mark: Mark | undefined
): Promise<void> {
  const fileName = path.basename(filePath);
  const settings = readSettings(vscode.workspace.getConfiguration('pdf2note'));
  outputChannel.clear();
  outputChannel.appendLine(`📝 ${fileName} → note PDF`);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Adding note area to ${fileName}`, cancellable: true },
    async (progress, token) => {
      let reached = 0;
      const report = (message: string, fraction: number) => {
        const next = Math.round(fraction * 100);
        progress.report({ message, increment: next - reached });
        reached = next;
      };
      try {
        await addNotesToFile(context, filePath, password, mark, settings, token, report);
      } catch (error) {
        if (token.isCancellationRequested || error instanceof CancelledError) {
          outputChannel.appendLine('⏹ Cancelled');
          vscode.window.showInformationMessage(`Cancelled: ${fileName}`);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`❌ Error: ${message}`);
        // Not awaited: the progress notification must close with this callback.
        vscode.window.showErrorMessage(`PDF2Note failed: ${message}`, 'Show Log').then((choice) => {
          if (choice === 'Show Log') outputChannel.show();
        });
      }
    }
  );
}

async function addNotesToFile(
  context: vscode.ExtensionContext,
  filePath: string,
  password: string | undefined,
  mark: Mark | undefined,
  settings: Settings,
  token: vscode.CancellationToken,
  report: (message: string, fraction: number) => void
): Promise<void> {
  const sourceDir = path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, path.extname(filePath)).normalize('NFC');
  const vars = { file: baseName, name: baseName, date: localDate() };
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    outputChannel.appendLine(`⚠️ ${message}`);
  };

  // 1. Source PDF bytes: the file itself, or ipynb/md rendered in memory by the
  //    converter extension (no temp files). Its own header/footer are turned off
  //    because this extension draws them on the new, larger page.
  let input: Uint8Array;
  if (ext === '.pdf') {
    report('Reading PDF…', 0.05);
    input = new Uint8Array(await fs.readFile(filePath));
  } else {
    const converter = await converterApi();
    report('Converting to PDF…', 0.02);
    input = await converter.convertToPdfBytes({
      filePath,
      overrides: { headerText: '', footerText: '' },
      token,
      onProgress: (message, fraction) => report(message, 0.02 + fraction * 0.48),
    });
  }
  if (token.isCancellationRequested) throw new CancelledError();
  const base = ext === '.pdf' ? 0.05 : 0.5;
  const src = await openSource(input, path.basename(filePath));

  // 2. Assets.
  const banner =
    settings.layoutMode === 'feedback'
      ? settings.feedbackBannerImage
        ? await loadImage(settings.feedbackBannerImage, sourceDir).catch((error) => {
            warn(`Feedback banner not loaded (${settings.feedbackBannerImage}): ${messageOf(error)}`);
            return null;
          })
        : (warn('Feedback mode: no banner configured (pdf2note.feedbackBannerImage); drawing the divider only'), null)
      : null;
  const markImage = mark
    ? await loadImage(MARK_IMAGES[mark], sourceDir).catch((error) => {
        warn(`Instructor mark not loaded (${MARK_IMAGES[mark]}): ${messageOf(error)}`);
        return null;
      })
    : null;
  if (mark && markImage) {
    outputChannel.appendLine(`🖼️ Teacher mode: ${mark === 'ho' ? 'hossam' : 'jussam'} mark on every page`);
  }
  if (!fontCache) {
    const fontPath = context.asAbsolutePath(path.join('media', 'fonts', 'NanumGothic.ttf'));
    try {
      fontCache = new Uint8Array(await fs.readFile(fontPath));
    } catch {
      throw new Error('Bundled font missing (media/fonts/NanumGothic.ttf). Reinstall the PDF2Note extension.');
    }
  }

  // 3. Layout.
  report('Adding note areas…', base);
  const paper = resolvePaper(settings.paperSize);
  outputChannel.appendLine(
    `Layout: ${settings.layoutMode}, paper ${paper ? settings.paperSize.toUpperCase() : 'original size'}, line gap ${settings.lineGap} pt`
  );
  const { doc, pages, warnings: layoutWarnings } = await addNoteArea(src, {
    vars: { file: vars.file, date: vars.date },
    header: { text: settings.headerText, align: settings.headerAlign },
    footer: { text: settings.footerText, align: settings.footerAlign },
    fontSize: settings.headerFooterFontSize,
    fontBytes: fontCache,
    paper,
    mode: settings.layoutMode,
    lineGap: settings.lineGap,
    banner,
    mark: markImage,
    markWidth: MARK_WIDTH,
    onProgress: (done, total) => {
      if (token.isCancellationRequested) throw new CancelledError();
      report(`Adding note areas… (${done}/${total})`, base + (done / total) * (0.9 - base));
    },
  });
  layoutWarnings.forEach(warn);

  // 4. Password (same rule as ipynb-pdf-converter; AES-256 here).
  if (password) {
    doc.encrypt({
      userPassword: password,
      ownerPassword: settings.ownerPassword || randomBytes(16).toString('hex'),
      permissions: permissionFlags(settings.pdfPermissions),
      algorithm: 'AES-256',
    });
  }

  // 5. Save without overwriting: "name (1).pdf", "name (2).pdf", …
  report('Saving…', 0.95);
  const bytes = await doc.save();
  const outputDir = settings.outputDirectory ? path.resolve(sourceDir, settings.outputDirectory) : sourceDir;
  const outputName = (expand(settings.outputFileName, vars) || `${baseName}_note`).replace(/\.pdf$/i, '');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = await uniquePdfPath(outputDir, outputName);
  await fs.writeFile(outputPath, bytes);
  report('Done', 1);
  outputChannel.appendLine(`✅ Saved: ${outputPath} (${pages} page${pages === 1 ? '' : 's'})`);

  const summary = `✅ Note PDF${password ? ' (password protected)' : ''}: ${path.basename(outputPath)}`;
  // Not awaited: the progress notification must close when this function returns.
  if (warnings.length > 0) {
    vscode.window
      .showWarningMessage(`${summary} — ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`, 'Show Log')
      .then((choice) => {
        if (choice === 'Show Log') outputChannel.show();
      });
  } else {
    vscode.window.showInformationMessage(summary);
  }
  if (settings.openAfterConvert) {
    await vscode.env.openExternal(vscode.Uri.file(outputPath));
  }
}

// Opens the source PDF; a password-protected source asks for its password once.
async function openSource(input: Uint8Array, fileName: string): Promise<PDFDocument> {
  try {
    return await loadSource(input);
  } catch (error) {
    if (!(error instanceof SourceEncryptedError)) {
      throw error;
    }
  }
  const password = await vscode.window.showInputBox({
    title: 'Source PDF password',
    prompt: `"${fileName}" is password protected. Enter its password to open it.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) {
    throw new CancelledError();
  }
  try {
    return await loadSource(input, password);
  } catch (error) {
    throw error instanceof WrongPasswordError ? new Error(`Wrong password for "${fileName}"`) : error;
  }
}

async function converterApi(): Promise<ConverterApi> {
  const extension = vscode.extensions.getExtension<ConverterApi>(CONVERTER_ID);
  if (!extension) {
    throw new Error(`The "Ipynb PDF Converter" extension (${CONVERTER_ID}) is required to convert .ipynb/.md files`);
  }
  const api = await extension.activate();
  if (!api || typeof api.convertToPdfBytes !== 'function') {
    throw new Error(
      'Ipynb PDF Converter is too old or not reloaded: it must expose convertToPdfBytes (0.9+). After updating it, run "Developer: Reload Window".'
    );
  }
  return api;
}

async function loadImage(src: string, baseDir: string): Promise<{ bytes: Uint8Array }> {
  if (/^https?:/i.test(src)) {
    const response = await fetch(src, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { bytes: new Uint8Array(await response.arrayBuffer()) };
  }
  const file = src.startsWith('file:') ? fileURLToPath(src) : path.resolve(baseDir, src);
  return { bytes: new Uint8Array(await fs.readFile(file)) };
}

async function uniquePdfPath(dir: string, name: string): Promise<string> {
  const exists = (p: string) => fs.access(p).then(() => true, () => false);
  let candidate = path.join(dir, `${name}.pdf`);
  for (let n = 1; await exists(candidate); n++) {
    candidate = path.join(dir, `${name} (${n}).pdf`);
  }
  return candidate;
}

function expand(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
}

function localDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const paperSizeNames = ['original', ...Object.keys(PAPER_SIZES)];

export function deactivate() {}
