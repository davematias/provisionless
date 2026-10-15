import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@provisionless/design-system";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Provisionless Admin</h1>
        <p className="text-sm text-muted-foreground">Manage your content from here.</p>
      </div>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Content</CardTitle>
          <CardDescription>Content management is coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>New content</Button>
        </CardContent>
      </Card>
    </div>
  );
}
