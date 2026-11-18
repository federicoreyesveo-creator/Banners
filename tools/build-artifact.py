# Arma una versión del sitio para publicar como Artifact de claude.ai (CSS inline, sin <html>/<head>).
import re, shutil, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]); shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True)
html = (root / 'index.html').read_text()
css = (root / 'styles.css').read_text()
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">\n'
page = ('<title>Banners HTML5</title>\n' + fonts + '<style>\n' + css + '\nhtml,body{height:100%}\n</style>\n'
        '<script src="vendor/jszip.min.js"></script>\n' + body)
(out / 'index.html').write_text(page)
for d in ['src', 'vendor']: shutil.copytree(root / d, out / d)
print('\n'.join(str(p.relative_to(out)) for p in sorted(out.rglob('*')) if p.is_file()))
