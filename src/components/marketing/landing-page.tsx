import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  Clock,
  Database,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Upload,
  Workflow,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";
import { Badge } from "@/components/ui";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#journey", label: "Get started" },
  { href: "#features", label: "Features" },
  { href: "#security", label: "Security" },
];

const DATA_SOURCES = [
  {
    icon: Database,
    title: "Published by our platform",
    description:
      "Our data team curates and publishes ready-to-use data products directly to the Catalog. Discover and subscribe — no upload required from you.",
  },
  {
    icon: Upload,
    title: "Built from your own data",
    description: "Upload and securely exchange your own files with your counterparties today.",
    comingSoon:
      "Harmonize your uploaded datasets into governed data products using our managed data pipelines.",
  },
];

const DOWNSTREAM_STEPS = [
  {
    icon: Boxes,
    title: "Discover",
    description: "Browse the Data Product Catalog to see what's available — schemas, contracts, and SLAs, documented up front.",
  },
  {
    icon: KeyRound,
    title: "Subscribe",
    description: "Get entitled and subscribe to the data products you need.",
  },
  {
    icon: RefreshCw,
    title: "Schedule",
    description: "Choose your delivery cadence — hourly to monthly, or trigger an on-demand run.",
  },
  {
    icon: Download,
    title: "Consume",
    description: "Receive data via the REST API, scheduled files, or on-demand downloads — your choice.",
  },
];

const JOURNEY_STEPS = [
  {
    step: "01",
    title: "Create your account",
    description:
      "Sign up and join your organization's tenant, or create a new one and invite your team. Admin approval keeps membership under your control.",
  },
  {
    step: "02",
    title: "Discover data products",
    description:
      "Browse the Data Product Catalog to see what's available — schemas, contracts, and SLAs are documented up front, before you commit to anything.",
  },
  {
    step: "03",
    title: "Get entitled & subscribe",
    description:
      "Request access to a product, then subscribe and choose how you want it delivered: real-time API reads, a scheduled drop, or an on-demand export.",
  },
  {
    step: "04",
    title: "Consume with confidence",
    description:
      "Pull data through the cursor-paginated API, download scheduled files, and track every exchange, delivery, and SLA in Notifications.",
  },
];

const FEATURES = [
  {
    icon: Upload,
    title: "Self-service exchange",
    description: "Upload and download data yourself, with signed URLs and full manifest history — no tickets required.",
  },
  {
    icon: Boxes,
    title: "Governed data catalog",
    description: "Every data product is versioned with a published schema, contract, and SLA before you ever consume it.",
  },
  {
    icon: KeyRound,
    title: "Entitlements & subscriptions",
    description: "Access is scoped per tenant and per product. What you're allowed to see and how you receive it are managed separately.",
  },
  {
    icon: Clock,
    title: "Flexible delivery",
    description: "Consume via a cursor-paginated REST API, a scheduled delivery cadence, or a one-off download — whatever fits your workflow.",
  },
  {
    icon: BarChart3,
    title: "End-to-end observability",
    description: "Track the health of every upload, publication, and delivery against its SLA from one operational view.",
  },
  {
    icon: ShieldCheck,
    title: "Enterprise-grade security",
    description: "Tenant-isolated data at every layer, encryption in transit and at rest, and SSO-ready identity.",
  },
];

const TRUST_POINTS = [
  { icon: Lock, label: "Tenant-isolated storage & queries" },
  { icon: ShieldCheck, label: "Encryption in transit and at rest" },
  { icon: Workflow, label: "Full audit trail on every exchange" },
  { icon: KeyRound, label: "SSO-ready identity provider" },
];

export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-slate-900 p-2">
              <Database className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <span className="text-base font-semibold text-slate-900">{APP_CONFIG.name}</span>
          </div>

          <nav className="hidden items-center gap-6 sm:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto max-w-3xl text-center">
              <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                Customer Data Exchange Platform
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                Your data, delivered your way
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
                {APP_CONFIG.name} is a self-service platform for discovering, subscribing to, and
                consuming governed data products — published directly by our platform or built
                from data you exchange with us — delivered to your inbox, API, or file drop.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 sm:w-auto"
                >
                  Create your account
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50 sm:w-auto"
                >
                  See how it works
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-b border-slate-200 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                How it works
              </h2>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                Two ways to get the data you need
              </p>
              <p className="mt-3 text-slate-600">
                Every data product in the Catalog is documented, versioned, and governed —
                whether it&apos;s published directly by our platform or built from data you
                exchange with us.
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {DATA_SOURCES.map((source) => (
                <div key={source.title} className="rounded-lg border border-slate-200 p-8">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900">
                    <source.icon className="h-5 w-5 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900">{source.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{source.description}</p>
                  {source.comingSoon ? (
                    <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <Badge color="yellow" className="mt-0.5 shrink-0">
                        Coming soon
                      </Badge>
                      <p className="text-sm text-amber-800">{source.comingSoon}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-16">
              <p className="text-center text-sm font-medium text-slate-500">
                However it started, every data product reaches you the same governed way
              </p>

              <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {DOWNSTREAM_STEPS.map((item, index) => (
                  <div key={item.title} className="relative flex flex-col items-start">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900">
                      <item.icon className="h-5 w-5 text-white" aria-hidden="true" />
                    </div>
                    <p className="text-xs font-semibold text-slate-400">
                      STEP {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-1.5 text-sm text-slate-600">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Customer journey */}
        <section id="journey" className="border-b border-slate-200 bg-slate-50 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Get started
              </h2>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                From sign-up to your first delivery in four steps
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {JOURNEY_STEPS.map((item) => (
                <div
                  key={item.step}
                  className="flex gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <span className="text-2xl font-semibold text-slate-300">{item.step}</span>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-1.5 text-sm text-slate-600">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 flex justify-center">
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                Start your first subscription
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-b border-slate-200 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Features
              </h2>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                Everything you need to consume data on your terms
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="rounded-lg border border-slate-200 p-6">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
                    <feature.icon className="h-5 w-5 text-slate-700" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">{feature.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Security / trust */}
        <section id="security" className="border-b border-slate-200 bg-slate-900 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Security
              </h2>
              <p className="mt-2 text-3xl font-semibold text-white">Built for trust from day one</p>
              <p className="mt-3 text-slate-300">
                Your data and your organization&apos;s access are isolated at every layer of the
                platform — never inferred from a URL, always resolved from your session.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST_POINTS.map((point) => (
                <div
                  key={point.label}
                  className="flex flex-col items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/60 p-6 text-center"
                >
                  <point.icon className="h-6 w-6 text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-medium text-white">{point.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <p className="mx-auto mb-4 flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              No sales call required to get started
            </p>
            <h2 className="text-3xl font-semibold text-slate-900">Ready to get your data?</h2>
            <p className="mt-3 text-slate-600">
              Create your account, join your organization, and subscribe to your first data
              product today.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 sm:w-auto"
              >
                Create your account
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50 sm:w-auto"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Database className="h-4 w-4" aria-hidden="true" />
            {APP_CONFIG.name}
          </div>
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} {APP_CONFIG.name}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
