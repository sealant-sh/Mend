import { useQuery } from "@tanstack/react-query";

import { processOutputQuery } from "#/lib/queries";

/**
 * Read-only durable process output on the terminal surface: the record's
 * bytes, replayed and polled — never an input path (plan §Services). Shared
 * by the logs modal and the logs tab.
 */
export function LogsView({ processId }: { readonly processId: string }) {
  const output = useQuery({ ...processOutputQuery(processId), refetchInterval: 1_500 });
  let content = output.data?.text || "no output recorded";
  if (output.isPending) content = "reading recorded output…";
  if (output.isError) {
    content = output.error instanceof Error ? output.error.message : "logs unavailable";
  }
  return (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-term p-4 font-mono text-[11.5px] leading-relaxed text-term-fg">
      {content}
    </pre>
  );
}
