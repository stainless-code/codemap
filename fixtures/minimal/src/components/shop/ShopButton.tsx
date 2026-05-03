import { usePermissions } from "../../usePermissions";

export function FormatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ShopButton() {
  const perms = usePermissions();
  return (
    <button type="button" disabled={!perms.canEdit}>
      Buy
    </button>
  );
}
