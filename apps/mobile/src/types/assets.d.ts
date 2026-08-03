declare module '*.html' {
  const asset: number;
  export default asset;
}
declare module '*.html?raw' {
  const source: string;
  export default source;
}
