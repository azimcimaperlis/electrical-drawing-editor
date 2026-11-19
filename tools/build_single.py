"""Build a single-file HTML editor.
  python3 tools/build_single.py            -> dist/editor-lukisan.html (standalone, drawing embedded)
  python3 tools/build_single.py --artifact OUT.html  (claude.ai artifact body, drawing fetched from drawings/qlwb.json)
"""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
artifact = '--artifact' in sys.argv

def inline_css(m):
    return '<style>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '\n</style>'
html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_css, html)

def inline_js(m):
    src = m.group(1)
    if src.startswith('drawings/') and artifact:
        return ''
    code = (root / src).read_text(encoding='utf-8').replace('</script', '<\\/script')
    return '<script>\n' + code + '\n</script>'
html = re.sub(r'<script src="((?:js|drawings)/[^"]+)"></script>', inline_js, html)

if artifact:
    for pat in [r'<!doctype html>\n', r'<html[^>]*>\n', r'<head>\n', r'<meta charset[^>]*>\n', r'<meta name="viewport"[^>]*>\n', r'</head>\n', r'<body>\n', r'</body>\n', r'</html>\n?']:
        html = re.sub(pat, '', html, count=1)
    out = pathlib.Path(sys.argv[sys.argv.index('--artifact') + 1])
else:
    out = root / 'dist' / 'editor-lukisan.html'
    out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, len(html))
