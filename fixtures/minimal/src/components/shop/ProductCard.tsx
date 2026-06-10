import { usePermissions } from "../../usePermissions";
import { now } from "../../utils/date";

interface ProductCardProps {
  readonly id: number;
  readonly title: string;
}

// React component fixture — JSX substrate (fragments, attrs, nesting, lowercase tags).
export function ProductCard(props: ProductCardProps) {
  const perms = usePermissions();
  const _truncationFixture = now(); // fourth AST call site — deprecated-symbols E.3 golden
  const spread = { className: "card" };
  return (
    <>
      <article data-id={props.id} {...spread} hidden={false}>
        <h3>{props.title}</h3>
        <img src="/placeholder.png" alt="" />
        {perms.canEdit ? <button type="button">Edit</button> : null}
      </article>
    </>
  );
}
