class OSMTileAdapter {
  constructor(tileLayer, options = {}) {
    this.tileLayer = tileLayer;
    this.tileSize = 256;
    this.mode = "standard";
    this.providers = {
      standard: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      satellite:
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    };
    this.attribution = options.attribution || "";
  }

  setMode(mode) {
    this.mode = mode;
  }

  latLngToWorld(lat, lng, zoom) {
    const sin = Math.sin((lat * Math.PI) / 180);
    const scale = this.tileSize * 2 ** zoom;
    return {
      x: ((lng + 180) / 360) * scale,
      y:
        (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) *
        scale,
    };
  }

  worldToLatLng(x, y, zoom) {
    const scale = this.tileSize * 2 ** zoom;
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lng };
  }

  getTileUrl(z, x, y) {
    return this.providers[this.mode]
      .replace("{z}", z)
      .replace("{x}", x)
      .replace("{y}", y);
  }

  renderTiles(view) {
    const { center, zoom, width, height } = view;
    const centerWorld = this.latLngToWorld(center.lat, center.lng, zoom);
    const topLeft = {
      x: centerWorld.x - width / 2,
      y: centerWorld.y - height / 2,
    };
    const startX = Math.floor(topLeft.x / this.tileSize);
    const startY = Math.floor(topLeft.y / this.tileSize);
    const endX = Math.floor((topLeft.x + width) / this.tileSize);
    const endY = Math.floor((topLeft.y + height) / this.tileSize);
    const maxTile = 2 ** zoom;
    const needed = new Set();

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        if (y < 0 || y >= maxTile) continue;
        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        const key = `${this.mode}:${zoom}:${wrappedX}:${y}`;
        needed.add(key);
        let img = this.tileLayer.querySelector(`[data-key="${key}"]`);
        if (!img) {
          img = document.createElement("img");
          img.className = "map-tile";
          img.draggable = false;
          img.dataset.key = key;
          img.src = this.getTileUrl(zoom, wrappedX, y);
          this.tileLayer.appendChild(img);
        }
        img.style.left = `${x * this.tileSize - topLeft.x}px`;
        img.style.top = `${y * this.tileSize - topLeft.y}px`;
      }
    }

    Array.from(this.tileLayer.children).forEach((child) => {
      if (!needed.has(child.dataset.key)) child.remove();
    });
  }
}

window.OSMTileAdapter = OSMTileAdapter;
