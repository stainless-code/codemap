import { usePermissions } from "../../usePermissions";
import { now } from "../../utils/date";

export function FormatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ShopButton() {
  const perms = usePermissions();
  const _stamp = now();
  return (
    <button type="button" disabled={!perms.canEdit}>
      Buy
    </button>
  );
}
