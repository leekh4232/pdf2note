# Changelog

## [0.1.0] - 2026-10-25

### Added
- Tablet paper sizes (iPad Pro/Air/mini, Galaxy Tab S11 / S11 Ultra·S12 Ultra), the same pages Ipynb PDF Converter produces for those devices.
- Password-protected source PDFs: owner-only protection opens silently; a user password is asked for once (wrong password and unreadable or empty PDFs fail with a clear message).
- First release: a port of `pdf2note.py` as a VSCode extension.
- Commands on `.pdf`, `.ipynb` and `.md` files (explorer, editor tab, editor body, notebook cell, palette): add a ruled note area and header/footer bands; with or without a password.
- `.ipynb`/`.md` inputs are rendered in memory by the Ipynb PDF Converter extension's API (no temp files).
- Layout rules of the script: landscape sources get the note area below with a border, portrait sources to the right; `/Rotate` pages laid out as displayed; feedback mode (banner + divider); named paper sizes or original size; dimensions scaled with the page.
- Header/footer with `{file}` `{date}` `{page}` `{total}`, alignment and size, Korean text via a bundled NanumGothic (subset-embedded).
- AES-256 password protection with permissions and owner password (empty owner password = the PDF password), teacher mode marks (hossam/jussam), progress notification with cancel, never-overwrite naming `name (1).pdf`, Korean/English UI strings.
