// Barrel re-export — exercises `re_export_source` on `exports` rows + the
// `barrel-files` recipe (top files by export count).
export { FormatPrice, ShopButton } from "./ShopButton";
export { ProductCard } from "./ProductCard";

// Default re-export shape — for `is_default = 1` coverage on `exports`.
export { default as PrimaryShopButton } from "./ShopButton.default";
