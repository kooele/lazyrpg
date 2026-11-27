// SVG files imported as text (Vite's ?raw), bundled into the game instead of fetched at startup.
declare module '*.svg?raw' {
  const svg: string;
  export default svg;
}
