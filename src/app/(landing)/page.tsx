"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Inbox,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Send,
  Sparkles,
  Sun,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const agenda = [
  { time: "09:30", title: "Product stand-up", meta: "Design team · 30 min", color: "bg-accent" },
  { time: "12:45", title: "Lunch with Mina", meta: "Little Fern · 1 hr", color: "bg-emerald-500" },
  { time: "16:00", title: "Review launch notes", meta: "Personal · 45 min", color: "bg-sky-500" },
];

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2 text-[17px] font-bold tracking-[-.06em]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-xs font-black text-white">n</span>
            udg<span className="text-accent">.</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#product" className="hover:text-foreground">Product</a>
            <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            <a href="#integrations" className="hover:text-foreground">Integrations</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} aria-label="Toggle theme" className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary hover:text-foreground">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link href="/login" className="hidden px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground sm:block">Sign in</Link>
            <Link href="/signup" className="rounded-lg bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Get started</Link>
            <button className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground md:hidden" aria-label="Open menu"><Menu className="h-4 w-4" /></button>
          </div>
        </div>
      </header>

      <main>
        <section id="product" className="border-b border-border bg-grid">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:gap-16">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .45 }}>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Your schedule, less effort</div>
              <h1 className="max-w-xl text-5xl font-bold leading-[1.02] tracking-[-.06em] sm:text-7xl">A calmer way to stay on top of life.</h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">Nudg turns quick thoughts into organized events and timely reminders. Capture plans in plain language, then get nudged where you already spend time.</p>
              <div className="mt-8 flex flex-wrap items-center gap-3"><Link href="/signup" className="rounded-lg bg-accent px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_-15px_var(--accent)] hover:-translate-y-0.5">Create your free account <ArrowRight className="ml-1 inline h-4 w-4" /></Link><span className="text-xs text-muted-foreground">No credit card required</span></div>
              <div className="mt-8 flex items-center gap-5 text-xs text-muted-foreground"><span><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />Natural language</span><span><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />Smart reminders</span></div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .55, delay: .08 }} className="rounded-2xl border border-border bg-card p-2 shadow-2xl shadow-black/10">
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="flex items-center justify-between border-b border-border px-4 py-3"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-[11px] font-black text-white">n</span><span className="text-xs font-semibold">Today</span></div><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="hidden sm:inline">Tuesday, November 19</span><div className="h-6 w-6 rounded-full bg-secondary" /></div></div>
                <div className="grid md:grid-cols-[1fr_190px]">
                  <div className="border-b border-border p-4 md:border-b-0 md:border-r sm:p-6">
                    <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-medium text-muted-foreground">Good morning, Alex</p><p className="mt-1 text-lg font-bold tracking-tight">Here&apos;s your day</p></div><button className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Plus className="h-4 w-4" /></button></div>
                    <div className="mb-5 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3"><Sparkles className="h-4 w-4 shrink-0 text-accent" /><span className="flex-1 text-xs text-muted-foreground">What do you need to remember?</span><ChevronRight className="h-4 w-4 text-accent" /></div>
                    <div className="space-y-3">{agenda.map((item, index) => <motion.div key={item.title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .35 + index * .1 }} whileHover={{ x: 4 }} className="flex gap-3 rounded-xl border border-border bg-card p-3"><span className="w-10 pt-0.5 font-mono text-[10px] text-muted-foreground">{item.time}</span><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.color}`} /><div><p className="text-xs font-semibold">{item.title}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.meta}</p></div></motion.div>)}</div>
                  </div>
                  <div className="space-y-5 bg-secondary/30 p-4 sm:p-5"><div><div className="mb-3 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Next up</p><Clock3 className="h-4 w-4 text-accent" /></div><motion.div whileHover={{ y: -2 }} className="rounded-xl border border-border bg-card p-3"><p className="text-xs font-semibold">Lunch with Mina</p><p className="mt-1 text-[10px] text-muted-foreground">In 2 hours · reminder sent</p><div className="mt-3 h-1 rounded-full bg-secondary"><motion.div initial={{ width: "0%" }} animate={{ width: "66%" }} transition={{ duration: 1, delay: .8 }} className="h-1 rounded-full bg-accent" /></div></motion.div></div><div><div className="mb-3 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Channels</p><Bell className="h-4 w-4 text-accent" /></div><div className="space-y-2"><motion.div animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 2.4, repeat: Infinity }} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-[11px]"><MessageCircle className="h-3.5 w-3.5 text-emerald-500" /> WhatsApp <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500" /></motion.div><motion.div animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 2.4, delay: .5, repeat: Infinity }} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-[11px]"><Send className="h-3.5 w-3.5 text-sky-500" /> Telegram <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500" /></motion.div></div></div></div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[.16em] text-accent">How it works</p><h2 className="mt-3 text-3xl font-bold tracking-[-.04em] sm:text-4xl">Your assistant should fit your day, not the other way around.</h2><p className="mt-4 text-muted-foreground">Nudg handles the busywork between “I need to remember this” and “I&apos;m ready for it.”</p></div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">{[{ icon: Inbox, title: "Capture anything", body: "Type a plan the same way you would send a message. Nudg understands the important details." }, { icon: CalendarDays, title: "Keep it organized", body: "Events land in one clear schedule, with context, timing, and a simple view of what comes next." }, { icon: Bell, title: "Get the right nudge", body: "Choose the channels you already check and receive reminders before they become urgent." }].map(({ icon: Icon, title, body }, index) => <div key={title} className="rounded-2xl border border-border bg-card p-6"><div className="flex items-center justify-between"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent"><Icon className="h-5 w-5" /></div><span className="font-mono text-xs text-muted-foreground">0{index + 1}</span></div><h3 className="mt-12 text-lg font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p></div>)}</div>
        </section>

        <section id="integrations" className="border-y border-border bg-secondary/35"><div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-14 sm:px-8 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-accent">Works where you work</p><h2 className="mt-2 text-2xl font-bold tracking-tight">One schedule. Every important channel.</h2></div><div className="flex flex-wrap gap-2">{[{ icon: MessageCircle, label: "WhatsApp", color: "text-emerald-500" }, { icon: Send, label: "Telegram", color: "text-sky-500" }, { icon: CalendarDays, label: "Calendar", color: "text-accent" }, { icon: Bell, label: "Email", color: "text-amber-500" }].map(({ icon: Icon, label, color }) => <div key={label} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium"><Icon className={`h-4 w-4 ${color}`} />{label}</div>)}</div></div></section>

        <section className="mx-auto max-w-7xl px-5 py-20 text-center sm:px-8 sm:py-28"><h2 className="text-4xl font-bold tracking-[-.05em] sm:text-5xl">Make remembering the easy part.</h2><p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">Start with one plan. Nudg will help you carry it through.</p><Link href="/signup" className="mt-7 inline-flex items-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90">Get started free <ArrowRight className="ml-2 h-4 w-4" /></Link></section>
      </main>
      <footer className="border-t border-border"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8"><span className="font-bold text-foreground">nudg<span className="text-accent">.</span></span><span>Less remembering. More doing.</span><span>© {new Date().getFullYear()} Nudg</span></div></footer>
    </div>
  );
}
