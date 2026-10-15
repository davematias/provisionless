import { Button } from "../../components/ui/button.tsx";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Provisionless Admin</h1>
        <p className="text-sm text-muted-foreground">Manage your content from here.</p>
      </div>
      <Button>New content</Button>
    </div>
  );
}
