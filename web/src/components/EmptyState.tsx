export function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-black/10 px-6 py-10 text-center text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
      {message}
    </div>
  );
}
