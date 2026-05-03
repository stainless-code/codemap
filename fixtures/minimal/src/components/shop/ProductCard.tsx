import { usePermissions } from "../../usePermissions";

interface ProductCardProps {
  readonly id: number;
  readonly title: string;
}

// React component fixture — exercises `components` table fan-in to
// `usePermissions` (also used by ShopButton.tsx); pair with the barrel
// re-export in `./index.ts` to surface fan-in via the `dependencies` graph.
export function ProductCard(props: ProductCardProps) {
  const perms = usePermissions();
  return (
    <article>
      <h3>{props.title}</h3>
      {perms.canEdit ? <button type="button">Edit</button> : null}
    </article>
  );
}
