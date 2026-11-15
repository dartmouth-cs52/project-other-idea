// Wrangler bundles a .txt file as a string. The widget is brought into the Worker that way.
declare module "*.txt" {
  const text: string;
  export default text;
}
