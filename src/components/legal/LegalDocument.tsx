import path from "node:path";
import { readFile } from "node:fs/promises";
import { marketingSectionClass } from "@/components/marketing/marketingStyles";

export type LegalSourceFile = "policy.html" | "terms.html" | "EULA.html" | "cookies.html";

function extractDocumentContent(source: string) {
  const main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (main !== undefined) return main;

  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (body !== undefined) return body;

  return source;
}

function normalizeDocumentMarkup(content: string) {
  return content
    .replace(/<h1(\b[^>]*)>/i, '<h2 class="legal-document-title"$1>')
    .replace(/<\/h1>/i, "</h2>")
    .replaceAll(
      '<a href="<a href="https://dadhealth.co.uk">https://dadhealth.co.uk</a>/privacy"><a href="https://dadhealth.co.uk">https://dadhealth.co.uk</a>/privacy</a>',
      '<a href="https://dadhealth.co.uk/privacy">https://dadhealth.co.uk/privacy</a>',
    );
}

export default async function LegalDocument({ sourceFile }: { sourceFile: LegalSourceFile }) {
  const sourcePath = path.join(process.cwd(), "public", "terms_files", sourceFile);
  const source = await readFile(sourcePath, "utf8");
  const documentContent = normalizeDocumentMarkup(extractDocumentContent(source));

  return (
    <section className="bg-card text-foreground">
      <div className={marketingSectionClass}>
        <div className="overflow-x-auto">
          <article
            className="max-w-none text-[15px] leading-relaxed text-muted-foreground sm:text-base
              [&_.meta]:mb-8 [&_.meta]:text-sm [&_.meta]:text-muted-foreground
              [&_.note]:my-6 [&_.note]:rounded-2xl [&_.note]:border [&_.note]:border-primary/40 [&_.note]:bg-primary/5 [&_.note]:p-5 [&_.note]:shadow-[0_0_18px_hsl(var(--primary)/0.04)]
              [&_.warning]:my-6 [&_.warning]:rounded-2xl [&_.warning]:border [&_.warning]:border-primary/40 [&_.warning]:bg-primary/5 [&_.warning]:p-5 [&_.warning]:shadow-[0_0_18px_hsl(var(--primary)/0.04)]
              [&_a]:break-words [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4
              [&_h1]:mb-6 [&_h1]:font-heading [&_h1]:text-4xl [&_h1]:font-extrabold [&_h1]:leading-none [&_h1]:text-foreground sm:[&_h1]:text-5xl
              [&_.legal-document-title]:mt-0
              [&_h2]:mb-4 [&_h2]:mt-12 [&_h2]:font-heading [&_h2]:text-3xl [&_h2]:font-extrabold [&_h2]:leading-none [&_h2]:text-foreground sm:[&_h2]:text-4xl
              [&_h3]:mb-3 [&_h3]:mt-8 [&_h3]:font-heading [&_h3]:text-2xl [&_h3]:font-extrabold [&_h3]:leading-none [&_h3]:text-foreground
              [&_li]:my-2 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4
              [&_strong]:font-semibold [&_strong]:text-foreground
              [&_table]:my-7 [&_table]:min-w-[720px] [&_table]:border-collapse [&_table]:text-sm
              [&_td]:border [&_td]:border-border [&_td]:p-3 [&_td]:align-top
              [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-3 [&_th]:text-left [&_th]:font-heading [&_th]:font-extrabold [&_th]:text-foreground
              [&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6"
            dangerouslySetInnerHTML={{ __html: documentContent }}
          />
        </div>
      </div>
    </section>
  );
}
