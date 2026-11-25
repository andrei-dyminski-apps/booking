import {
  AUTHOR_NAME,
  AUTHOR_URL,
  REPOSITORY_URL,
  SITE_NAME,
  TECH_STACK,
} from "#shared/config";
import { ExternalLink } from "#shared/ui";

const LINK_CLASS = "inline-flex items-center gap-1 hover:text-foreground";

/**
 * The quiet end of every page: what this is, what it is built on, where to read the code
 * and who signed it. It is a portfolio piece, so it says so, and it says that the
 * payments are a sandbox before anybody reaches a card form.
 *
 * It carries no navigation: the sidebar already offers every section, and a second list
 * would be one more place for the role rules to drift.
 */
export const SiteFooter = () => (
  <footer className="border-t border-border">
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="flex flex-col gap-1">
        <p>
          {SITE_NAME} — a portfolio project. Payments run in Stripe test mode:
          no real money moves.
        </p>
        <p>{TECH_STACK.join(" · ")}</p>
      </div>
      <div className="flex flex-col gap-1 sm:items-end">
        <ExternalLink href={REPOSITORY_URL} icon className={LINK_CLASS}>
          Source code
        </ExternalLink>
        <p>
          © {new Date().getFullYear()}{" "}
          <ExternalLink href={AUTHOR_URL} icon className={LINK_CLASS}>
            {AUTHOR_NAME}
          </ExternalLink>
        </p>
      </div>
    </div>
  </footer>
);
