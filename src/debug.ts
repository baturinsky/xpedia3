import { convertPalette, generatePalette, parsePalette, RGBA, sweetie16 } from "./palettes";

export function paletteLine(rgb: RGBA) {
  let bg = toCSSColor(rgb)
  console.log(`%c           ${bg}`, `color:#00; background:${bg}`, `background:#fff`)
}

export function printPalette(p: RGBA[]) {
  for (let i in p) {
    let bg = toCSSColor(p[i])
    console.log(`%c          %c ${Number(i).toString(36)} ${bg}`, `color:#00; background:${bg}`, `background:#fff`)
  }

}
