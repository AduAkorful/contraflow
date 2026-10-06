/// First-sight gloss for jargon. Native `abbr` so the expansion is available without a custom widget.
export function Gloss({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <abbr title={title} className="cursor-help underline decoration-dotted decoration-faint underline-offset-2">
      {children}
    </abbr>
  );
}
