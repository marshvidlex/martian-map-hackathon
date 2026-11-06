# hacer_iconos.py
# Genera los iconos de la app (los pide el manifest para poder "instalarla" en la tablet).
# Uso:  python scripts/hacer_iconos.py

from PIL import Image, ImageDraw

for lado in (192, 512):
    img = Image.new("RGB", (lado, lado), "#1b1b1b")
    d = ImageDraw.Draw(img)
    m = lado // 8
    d.ellipse([m, m, lado - m, lado - m], fill="#e8794a")               # Marte
    d.ellipse([lado * 0.30, lado * 0.35, lado * 0.45, lado * 0.50], fill="#c25a2e")  # crater
    d.line([lado * 0.25, lado * 0.70, lado * 0.50, lado * 0.55, lado * 0.75, lado * 0.62],
           fill="#00e5ff", width=max(4, lado // 30))                    # ruta
    img.save(f"docs/icon-{lado}.png")
    print("guardado docs/icon-%d.png" % lado)