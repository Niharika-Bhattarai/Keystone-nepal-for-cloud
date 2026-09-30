// frontend/utils/svgToPngDataUrl.js
// High-resolution SVG -> PNG export helper.
// Default export is 4K-friendly so downloaded plans stay readable.

export async function svgToPngBlob(svgMarkup, options = {}) {
  const dataUrl = await svgToPngDataUrl(svgMarkup, options);
  const response = await fetch(dataUrl);
  return response.blob();
}

export async function svgToPngDataUrl(svgMarkup, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!svgMarkup || typeof svgMarkup !== 'string') {
        reject(new Error('svgToPngDataUrl: missing SVG markup'));
        return;
      }

      const {
        background = '#F6F4EF',
        exportWidth = 4096,
        exportHeight = null,
        mimeType = 'image/png',
        quality = 1,
      } = options;

      let svg = svgMarkup.trim();
      if (!svg.startsWith('<svg')) {
        reject(new Error('svgToPngDataUrl: input is not an SVG string'));
        return;
      }

      if (!svg.includes('xmlns=')) {
        svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      }

      const widthMatch = svg.match(/width=["']([\d.]+)(px)?["']/i);
      const heightMatch = svg.match(/height=["']([\d.]+)(px)?["']/i);
      const viewBoxMatch = svg.match(/viewBox=["']([\d.\s-]+)["']/i);

      let sourceWidth = widthMatch ? parseFloat(widthMatch[1]) : null;
      let sourceHeight = heightMatch ? parseFloat(heightMatch[1]) : null;

      if ((!sourceWidth || !sourceHeight) && viewBoxMatch) {
        const vb = viewBoxMatch[1].trim().split(/\s+/).map(Number);
        if (vb.length === 4) {
          sourceWidth = sourceWidth || vb[2];
          sourceHeight = sourceHeight || vb[3];
        }
      }

      if (!sourceWidth) sourceWidth = 1600;
      if (!sourceHeight) sourceHeight = 1000;

      const aspect = sourceWidth / sourceHeight;
      const finalWidth = Math.max(1, Math.round(exportWidth));
      const finalHeight = Math.max(1, Math.round(exportHeight || (finalWidth / aspect)));

      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = finalWidth;
          canvas.height = finalHeight;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(svgUrl);
            reject(new Error('svgToPngDataUrl: could not get canvas context'));
            return;
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, finalWidth, finalHeight);
          } else {
            ctx.clearRect(0, 0, finalWidth, finalHeight);
          }

          ctx.drawImage(img, 0, 0, finalWidth, finalHeight);
          URL.revokeObjectURL(svgUrl);
          resolve(canvas.toDataURL(mimeType, quality));
        } catch (err) {
          URL.revokeObjectURL(svgUrl);
          reject(err);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        reject(new Error('svgToPngDataUrl: unable to rasterize SVG'));
      };

      img.src = svgUrl;
    } catch (err) {
      reject(err);
    }
  });
}

export async function svgToPngDataUrl(svgMarkup, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            if (!svgMarkup || typeof svgMarkup !== 'string') {
                reject(new Error('svgToPngDataUrl: missing SVG markup'));
                return;
            }

            const {
                background = '#F6F4EF',
                exportWidth = 4096,
                exportHeight = null,
                mimeType = 'image/png',
            } = options;

            let svg = svgMarkup.trim();

            if (!svg.includes('xmlns=')) {
                svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
            }

            const viewBoxMatch = svg.match(/viewBox=["']([\d.\s-]+)["']/i);
            const widthMatch = svg.match(/width=["']([\d.]+)(px)?["']/i);
            const heightMatch = svg.match(/height=["']([\d.]+)(px)?["']/i);

            let sourceWidth = widthMatch ? parseFloat(widthMatch[1]) : null;
            let sourceHeight = heightMatch ? parseFloat(heightMatch[1]) : null;

            if ((!sourceWidth || !sourceHeight) && viewBoxMatch) {
                const vb = viewBoxMatch[1].trim().split(/\s+/).map(Number);
                if (vb.length === 4) {
                    sourceWidth = vb[2];
                    sourceHeight = vb[3];
                }
            }

            if (!sourceWidth) sourceWidth = 1600;
            if (!sourceHeight) sourceHeight = 1000;

            const aspect = sourceWidth / sourceHeight;
            const finalWidth = exportWidth;
            const finalHeight = exportHeight || Math.round(exportWidth / aspect);

            const img = new Image();

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = finalWidth;
                    canvas.height = finalHeight;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('svgToPngDataUrl: could not get canvas context'));
                        return;
                    }

                    if (background) {
                        ctx.fillStyle = background;
                        ctx.fillRect(0, 0, finalWidth, finalHeight);
                    } else {
                        ctx.clearRect(0, 0, finalWidth, finalHeight);
                    }

                    ctx.drawImage(img, 0, 0, finalWidth, finalHeight);
                    resolve(canvas.toDataURL(mimeType));
                } catch (err) {
                    reject(err);
                }
            };

            img.onerror = () => reject(new Error('svgToPngDataUrl: unable to rasterize SVG'));
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        } catch (err) {
            reject(err);
        }
    });
}
