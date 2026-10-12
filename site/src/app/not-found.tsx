import Link from "next/link";
import { PageIntro } from "@/components/ui/page-intro";
import { IconDnf } from "@/components/icons";
import { OldSessionRedirect } from "@/components/stats/old-session-redirect";

export default function NotFound() {
  return (
    <>
      <OldSessionRedirect />
      <PageIntro
        label={
          <span className="inline-flex items-center gap-2">
            <IconDnf size="1rem" /> 404
          </span>
        }
        title="Page not found"
        dek={
          <>
            The page does not exist. Try the <Link href="/" className="text-ink underline underline-offset-2">forecast</Link>, the{" "}
            <Link href="/standings" className="text-ink underline underline-offset-2">standings</Link> or the{" "}
            <Link href="/history" className="text-ink underline underline-offset-2">history</Link>.
          </>
        }
      />
    </>
  );
}
