"""Dark variant of a README diagram (media/readme/*.svg) for the intro page (docs/assets).

Usage: python3 scripts/darken_svg.py media/readme/X.svg /tmp/X-dark.svg && rsvg-convert -z 2 /tmp/X-dark.svg -o docs/assets/X.png
"""
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
s = s.replace('<rect x="0.5" y="0.5"', '<rect data-card="1" x="0.5" y="0.5"')
s = re.sub(r'(<rect data-card="1"[^>]*?)fill="#ffffff" stroke="#d0d7de"', r'\1fill="#161b22" stroke="#30363d"', s)
s = re.sub(r'(<rect[^>]*rx="12"[^>]*?)fill="#f6f8fa" stroke="#d0d7de"', r'\1fill="#1f2630" stroke="#30363d"', s)
s = re.sub(r'(<rect[^>]*rx="12"[^>]*?)fill="#eef1fb" stroke="#9aa6c2"', r'\1fill="#1e2540" stroke="#4a5a9a"', s)
def text_fix(m):
    t = m.group(0)
    size = re.search(r'font-size="([\d.]+)"', t)
    if size and float(size.group(1)) < 9:
        return t
    return (t.replace('fill="#24292f"', 'fill="#e6edf3"').replace('fill="#57606a"', 'fill="#9da7b3"')
             .replace('fill="#8c96a8"', 'fill="#9da7b3"').replace('fill="#3f54b5"', 'fill="#8fa3f0"'))
s = re.sub(r'<text[^>]*>', text_fix, s)
s = re.sub(r'<tspan[^>]*>', lambda m: m.group(0).replace('fill="#3f54b5"', 'fill="#8fa3f0"'), s)
s = s.replace('<g font-size="12" fill="#57606a">', '<g font-size="12" fill="#9da7b3">')
s = s.replace('<g font-size="11.5" fill="#57606a">', '<g font-size="11.5" fill="#9da7b3">')
s = s.replace('data-card="1" ', '')
open(dst, 'w').write(s)
