// pdfjs-dist 4.10.38, vendored locally (public/vendor/pdfjs/) rather than
// pulled from a CDN — this app's index.html is one big classic (non-module)
// <script>, but pdfjs-dist ships ESM-only, so this tiny module script does
// the import and hands the library to the classic script via window.
// Pinned to the 4.x line deliberately, not "latest" (6.x): the current
// 6.3.289 release uses Map.prototype.getOrInsertComputed, a very new JS
// proposal not yet universally supported — it threw
// "getOrInsertComputed is not a function" in real testing. 4.x has none
// of that risk and is what this app actually needs to work reliably on,
// among other things, iOS Safari/WebKit.
import * as pdfjsLib from './pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
