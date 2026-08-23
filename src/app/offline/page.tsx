import { Card, Empty } from "@/components/ui";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <Card>
      <Empty
        title="You're offline"
        hint="Marketing HQ reads live data, so it needs a connection. Anything you were part-way through typing is still in the tab."
      />
    </Card>
  );
}
