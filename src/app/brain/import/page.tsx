import Link from "next/link";
import { asc } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { isConfigured } from "@/lib/env";
import { Card, Empty, PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/import-wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

export default async function ImportPage() {
  const clientRows = await db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name));

  return (
    <>
      <Link href="/brain?tab=library" className="btn btn-ghost btn-sm mb-3 -ml-2">
        <ArrowLeft size={14} />
        Brain
      </Link>

      <PageHeader
        title="Import into the brain"
        subtitle="Bring in what you already know. Claude reads it, pulls out what will still matter in a year, and you decide what stays."
      />

      {isConfigured.anthropic() ? (
        <div className="max-w-[820px]">
          <ImportWizard clients={clientRows} />
        </div>
      ) : (
        <Card className="max-w-[820px]">
          <Empty
            title="This one needs Claude"
            hint="Import reads your documents and splits them into properly-tagged entries, so it needs an ANTHROPIC_API_KEY in your environment. Until then you can still capture entries by hand."
            action={
              <Link href="/brain/new" className="btn btn-sm btn-primary">
                Capture one by hand
              </Link>
            }
          />
        </Card>
      )}
    </>
  );
}
