// lib/getEmbeddedFontCss.js (CommonJS)
const fs = require("fs");
const path = require("path");

let cachedCss = null;

function getEmbeddedFontCss() {
  if (cachedCss) return cachedCss;

  // Path to your font file in the deployed filesystem
  const fontPath = path.join(__dirname, "Inter-Regular.woff2");
  const fontB64 = fs.readFileSync(fontPath).toString("base64");

  cachedCss = `
    @font-face {
      font-family: "KeystoneSans";
      src: url("data:font/woff2;base64,${fontB64}") format("woff2");
      font-weight: 400;
      font-style: normal;
    }
  `.trim();

  return cachedCss;
}

module.exports = { getEmbeddedFontCss };
