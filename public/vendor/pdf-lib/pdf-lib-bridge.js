// pdf-lib 1.17.1, vendored locally (public/vendor/pdf-lib/) rather than
// pulled from a CDN, for the same reasons as public/vendor/pdfjs/: no
// other external script dependencies, and this app's index.html is one
// big classic (non-module) <script>, so this tiny module script does the
// import and hands the library to it via window.PDFLib — used to write
// the Label Prep PDF output (pdfjs-dist only reads PDFs, it can't write
// them).
import * as PDFLib from './pdf-lib.esm.min.js';

window.PDFLib = PDFLib;
