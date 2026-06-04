interface ChildCardProps {
  readonly label: string;
}

export function ChildCard(props: ChildCardProps) {
  return <p>{props.label}</p>;
}
