"""Inline local UI assets for pywebview's html= transport, including frozen builds."""
from pathlib import Path

def load_ui(directory):
    directory=Path(directory)
    html=(directory/'index.html').read_text(encoding='utf-8')
    html=html.replace('<link rel="stylesheet" href="games.css">','<style>'+(directory/'games.css').read_text(encoding='utf-8')+'</style>')
    html=html.replace('<script src="games.js"></script>','<script>'+(directory/'games.js').read_text(encoding='utf-8')+'</script>')
    return html
