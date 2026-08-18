import os
from PIL import Image
from collections import Counter

def remove_adaptive_background(img_path, output_path):
    if not os.path.exists(img_path):
        print(f"File not found: {img_path}")
        return
        
    img = Image.open(img_path).convert("RGBA")
    width, height = img.size
    pixels = img.load()
    
    # 1. Sample boundary pixels to find dominant background colors
    boundary_colors = []
    # Top and bottom rows
    for x in range(width):
        boundary_colors.append(pixels[x, 0])
        boundary_colors.append(pixels[x, height - 1])
    # Left and right columns
    for y in range(height):
        boundary_colors.append(pixels[0, y])
        boundary_colors.append(pixels[width - 1, y])
        
    # We round colors to a lower resolution to group similar shades (handles compression)
    def simplify_color(c):
        return (c[0] // 8 * 8, c[1] // 8 * 8, c[2] // 8 * 8)
        
    simplified_colors = [simplify_color(c) for c in boundary_colors if c[3] > 0]
    
    # Find the top 2 dominant simplified colors on the border
    color_counts = Counter(simplified_colors)
    dominant = [color for color, count in color_counts.most_common(2)]
    
    print(f"Detected dominant background colors: {dominant}")
    
    # Helper to check if a pixel color is close to any dominant color
    def is_background(c, threshold=45):
        if c[3] == 0:
            return True
        # If it's pure white or very close, it's background
        if c[0] > 230 and c[1] > 230 and c[2] > 230:
            return True
        # If it's close to any of the dominant background colors
        for dom in dominant:
            dist = sum((a - b) ** 2 for a, b in zip(c[:3], dom)) ** 0.5
            if dist < threshold:
                return True
        return False

    # 2. Perform Queue-based Flood Fill starting from borders to only remove connected background
    visited = set()
    queue = []
    
    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))
        
    while queue:
        cx, cy = queue.pop(0)
        if (cx, cy) in visited:
            continue
        visited.add((cx, cy))
        
        if cx < 0 or cx >= width or cy < 0 or cy >= height:
            continue
            
        current_color = pixels[cx, cy]
        
        if is_background(current_color):
            pixels[cx, cy] = (0, 0, 0, 0)
            
            # Queue neighbors
            for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in visited:
                    queue.append((nx, ny))
                    
    # 3. Clean up any lingering isolated background pixels that were not connected
    for x in range(width):
        for y in range(height):
            c = pixels[x, y]
            if c[3] > 0 and is_background(c, threshold=30):
                pixels[x, y] = (0, 0, 0, 0)
                
    img.save(output_path, "PNG")
    print(f"Background successfully removed and saved to {output_path}")

if __name__ == "__main__":
    # Usage: python tools/remove_bg.py <in.png> [out.png]   (run from the repo root)
    # Defaults to the camel master, which moved to _design-src/ in the 2026-08
    # reorganization. Edits in place when no output path is given, as before.
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else "_design-src/pixel_camel.png"
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    remove_adaptive_background(src, dst)
