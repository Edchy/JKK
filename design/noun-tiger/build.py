"""Build the circular vector lockup and app/icon exports from the supplied SVG.
Run with a Python environment containing fontTools, cairosvg and Pillow.
"""
from pathlib import Path
from html import escape
import math, shutil, io
from xml.etree import ElementTree as ET
import cairosvg
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
INK='#2a2926'; PAPER='#f3efe6'
source=HERE/'source.svg'
if not source.exists():
 shutil.copy2(Path.home()/'Downloads/noun_Tiger_6119221_FFFFFF.svg',source)
root=ET.parse(source).getroot()
ns='{http://www.w3.org/2000/svg}'
paths=''.join(f'<path d="{p.attrib["d"]}"/>' for p in root.findall(ns+'path'))
font=TTFont(ROOT/'app/fonts/dm-sans-latin-wght-normal.woff2')
if 'fvar' in font:font=instantiateVariableFont(font,{'wght':700},inplace=False)
glyphs=font.getGlyphSet();cmap=font.getBestCmap();upem=font['head'].unitsPerEm

def curved(text,radius,bottom=False):
 size=51; tracking=7; scale=size/upem
 widths=[glyphs[cmap[ord(c)]].width*scale for c in text]
 total=sum(widths)+tracking*(len(text)-1);cursor=-total/2;parts=[]
 for c,width in zip(text,widths):
  offset=(cursor+width/2)/radius
  theta=math.pi/2-offset if bottom else -math.pi/2+offset
  x=400+radius*math.cos(theta);y=400+radius*math.sin(theta)
  rotation=math.degrees(theta)+(-90 if bottom else 90)
  pen=SVGPathPen(glyphs);glyphs[cmap[ord(c)]].draw(pen)
  if pen.getCommands():
   parts.append(f'<path transform="translate({x:.5f} {y:.5f}) rotate({rotation:.5f}) scale({scale:.7f} {-scale:.7f}) translate({-glyphs[cmap[ord(c)]].width/2:.3f} 0)" d="{pen.getCommands()}"/>')
  cursor+=width+tracking
 return ''.join(parts)

def svg(body,view='0 0 800 800',label='Järna Kung Fu & Kultur'):
 label=escape(label,quote=True)
 return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" role="img" aria-label="{label}"><title>{label}</title>{body}</svg>'

logo=svg(f'<g fill="{INK}"><circle cx="400" cy="400" r="377" fill="none" stroke="{INK}" stroke-width="3"/>{curved("JÄRNA KUNG FU",303)}{curved("& KULTUR",341,True)}<circle cx="73" cy="400" r="5"/><circle cx="727" cy="400" r="5"/><g transform="translate(144 137)">{paths}</g></g>')
(HERE/'logo.svg').write_text(logo)
mark=svg(f'<g fill="{INK}">{paths}</g>',view='36 16 440 480',label='Tiger')
(HERE/'tiger.svg').write_text(mark)
# Original head, generous safe padding; no name around the small icons.
icon=svg(f'<rect width="512" height="512" fill="{PAPER}"/><g fill="{INK}" transform="translate(15 5) scale(.94)">{paths}</g>',view='0 0 512 512',label='Tiger')
maskable=svg(f'<rect width="512" height="512" fill="{PAPER}"/><g fill="{INK}" transform="translate(64 64) scale(.75)">{paths}</g>',view='0 0 512 512',label='Tiger')
(HERE/'favicon.svg').write_text(icon)
(HERE/'app-icon.svg').write_text(icon)

def png(s,size,dest):
 cairosvg.svg2png(bytestring=s.encode(),output_width=size,output_height=size,write_to=str(dest))

png(logo,800,HERE/'logo.png')
for size in (16,32,48):png(icon,size,HERE/f'favicon-{size}.png')
# Compose ICO from separately rendered sizes rather than downsampling one master.
frames=[Image.open(HERE/f'favicon-{n}.png').convert('RGBA') for n in (16,32,48)]
frames[-1].save(HERE/'favicon.ico',sizes=[(16,16),(32,32),(48,48)],append_images=frames[:-1])
for name,size in [('apple-touch-icon.png',180),('icon-192.png',192),('icon-512.png',512)]:png(icon,size,HERE/name)
png(maskable,512,HERE/'icon-maskable-512.png')
for name in ['logo.svg','tiger.svg']:
 shutil.copy2(HERE/name,ROOT/'app/img'/('jarna-round-logo.svg' if name=='logo.svg' else 'noun-tiger.svg'))
for name in ['favicon.svg','favicon.ico','favicon-16.png','favicon-32.png','favicon-48.png','apple-touch-icon.png','icon-192.png','icon-512.png','icon-maskable-512.png']:
 shutil.copy2(HERE/name,ROOT/'app/icons'/('noun-tiger-'+name))
print('Built circular logo, outlined text, text-free favicon and app icons.')
