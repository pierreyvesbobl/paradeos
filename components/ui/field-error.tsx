type Props = {
  /** Liste de messages renvoyés par Zod (`fieldErrors[key]`). */
  messages: string[] | undefined;
};

export function FieldError({ messages }: Props) {
  if (!messages || messages.length === 0) return null;
  if (messages.length === 1) {
    return <p className="text-destructive text-xs">{messages[0]}</p>;
  }
  return (
    <ul className="space-y-0.5">
      {messages.map((m) => (
        <li key={m} className="text-destructive text-xs">
          {m}
        </li>
      ))}
    </ul>
  );
}
