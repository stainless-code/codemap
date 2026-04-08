export function FormatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ShopButton() {
  return <button type="button">Buy</button>;
}
