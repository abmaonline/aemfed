// Used to read json files using 'import data from "./data.json"' pattern
declare module "*.json" {
  const value: any;
  export default value;
}
