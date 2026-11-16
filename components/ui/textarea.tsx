import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-border bg-surface px-2.5 py-2",
          // `text-base md:text-sm` — pelo mesmo motivo do `components/ui/input.tsx`:
          // o Safari do iPhone dá zoom na página quando o campo recebe foco com
          // fonte menor que 16px, e `text-sm` são 14. A régua inteira está no
          // comentário daquele arquivo.
          "text-base leading-relaxed text-text placeholder:text-text-muted md:text-sm",
          "transition-[border-color,box-shadow] duration-fast ease-out",
          "hover:border-border-strong",
          "focus-visible:border-accent-500 focus-visible:ring-[3px] focus-visible:ring-accent-500/15 focus-visible:outline-hidden",
          "disabled:cursor-not-allowed disabled:opacity-55",
          "aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error-bg",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
