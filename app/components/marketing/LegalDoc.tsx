function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function LegalDoc({
  title,
  updated,
  summary,
  sections,
}: {
  title: string;
  updated: string;
  summary: string;
  sections: { title: string; body: string[] }[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 pt-10 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
      <nav
        aria-label="On this page"
        className="mb-10 lg:sticky lg:top-24 lg:mb-0 lg:self-start"
      >
        <p className="text-sm font-medium text-foreground">On this page</p>
        <ul className="mt-3 space-y-2 text-sm">
          {sections.map((section) => (
            <li key={section.title}>
              <a href={`#${slug(section.title)}`} className="text-muted hover:text-foreground">
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article>
        <h1 className="font-serif-display text-5xl leading-[1.05]">{title}</h1>
        <p className="mt-6 text-sm text-muted">Last updated {updated}</p>
        <div className="mt-8 rounded-card border border-border-subtle bg-surface-1 px-5 py-4">
          <p className="text-sm font-medium">In short</p>
          <p className="mt-2 text-sm text-muted">{summary}</p>
        </div>
        <div className="mt-12 space-y-10">
          {sections.map((section) => (
            <section key={section.title} id={slug(section.title)} className="scroll-mt-28">
              <h2 className="text-lg font-medium text-foreground">{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 48)} className="mt-2 text-sm text-muted">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
