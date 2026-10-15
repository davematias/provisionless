import { Button, Card, CardDescription, CardHeader, CardTitle } from "@provisionless/design-system";

import { site } from "../lib/site.ts";

const FEATURES = [
  {
    title: "Serverless by default",
    description: "Runs on AWS Lambda with no servers to manage or scale.",
  },
  {
    title: "Headless content API",
    description: "A generic content API you can use from any front end or agent.",
  },
  {
    title: "Typed content models",
    description: "Define content types and validate entries against their schema.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4">
      <section className="flex flex-col items-start gap-6 py-20">
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Serverless, headless CMS
        </span>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Content management, without the servers
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          {site.description} Deploy to AWS in minutes and manage your content from anywhere.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <a href={site.githubUrl} target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href={`${site.githubUrl}#readme`} target="_blank" rel="noreferrer">
              Read the docs
            </a>
          </Button>
        </div>
      </section>
      <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title}>
            <CardHeader>
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  );
}
