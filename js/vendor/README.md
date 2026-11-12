# Vendored browser libraries

Third-party code served from this origin. Nothing here is loaded from a CDN.
Files are byte-identical copies of the published npm artifacts; verify with
`sha256sum` before replacing one.

| File | Package | Version | License | sha256 |
|------|---------|---------|---------|--------|
| `pdf-lib.min.js` | `pdf-lib` (`dist/pdf-lib.min.js`) | 1.17.1 | MIT (`pdf-lib.LICENSE.md`) | `0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f` |
| `fontkit.umd.min.js` | `@pdf-lib/fontkit` (`dist/fontkit.umd.min.js`) | 1.1.1 | MIT | `d8df561b9fba98e24f2e5130e40948809281bbbc55a20c412359f1a0a5eb35a6` |

Used only by the interview summary PDF (`js/voice-summary-pdf.js`). The page
injects both scripts the first time someone chooses "Download summary PDF",
so they cost nothing on a normal page load.

The matching fonts live in `assets/fonts/` (Inter 4.1, SIL Open Font License,
see `assets/fonts/Inter-LICENSE.txt`). They are the `inter-ui` npm package's
`web/Inter-Regular.woff2` and `web/Inter-Bold.woff2`, converted to TrueType
with fontTools because the PDF library cannot subset WOFF2:

    pyftsubset Inter-Regular.woff2 --unicodes='*' --flavor= \
      --layout-features='kern,mark,mkmk,ccmp,locl' --no-hinting \
      --desubroutinize --name-IDs='*' --notdef-outline \
      --output-file=Inter-Regular.ttf
