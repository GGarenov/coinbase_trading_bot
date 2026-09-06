export function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-10 text-center text-base text-muted">
      {message}
    </div>
  );
}
